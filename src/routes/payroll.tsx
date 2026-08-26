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
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { jsPDF } from "jspdf";

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

  // effectiveMonth always derives from filterYear + month index so they stay in sync
  const effectiveMonth = new Date(Number(filterYear), month.getMonth(), 1);
  const fromISO = iso(effectiveMonth);
  const toISO   = iso(new Date(Number(filterYear), month.getMonth() + 1, 0));

  // Yearly overview
  const { data: yearlyLeaves = [] } = useQuery({
    queryKey: ["payroll-yearly", profile?.id, filterYear],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("leave_type, total_days, paid_days, unpaid_days, status, from_date")
        .eq("teacher_id", profile!.id)
        .in("status", ["approved", "hod_approved"])
        .gte("from_date", `${filterYear}-01-01`)
        .lte("from_date", `${filterYear}-12-31`);
      return data ?? [];
    },
  });

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

  const chartData = [
    { name: "Net Pay", value: totals.net, color: "#22c55e" },
    { name: "Deduction", value: totals.deduction, color: "#ef4444" },
  ].filter((d) => d.value > 0);

  function downloadPayslip() {
    const doc = new jsPDF({ unit: "mm", format: "a5" });
    const month = effectiveMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    doc.setFontSize(15); doc.text("Chandrabhan Sharma College", 14, 18);
    doc.setFontSize(10); doc.text("Payslip", 14, 26);
    doc.text(`Teacher : ${profile?.full_name ?? ""}`, 14, 34);
    doc.text(`Period  : ${month}`, 14, 40);
    doc.line(14, 44, 134, 44);
    doc.text(`Gross Salary   ${money(salary).padStart(14)}`, 14, 52);
    doc.text(`Paid Days      ${String(totals.paid).padStart(14)}`, 14, 58);
    doc.text(`Unpaid Days    ${String(totals.unpaid).padStart(14)}`, 14, 64);
    doc.text(`Deduction     -${money(totals.deduction).padStart(13)}`, 14, 70);
    doc.line(14, 74, 134, 74);
    doc.setFontSize(12);
    doc.text(`Net Payable    ${money(totals.net).padStart(14)}`, 14, 82);
    const safeName = (profile?.full_name ?? "payslip").split(" ").join("_");
    const safePeriod = month.replace(" ", "_");
    doc.save(`Payslip_${safeName}_${safePeriod}.pdf`);
  }

  const yearlyTotals = {
    totalDays:   yearlyLeaves.reduce((s, l) => s + Number(l.total_days), 0),
    paidDays:    yearlyLeaves.reduce((s, l) => s + Number(l.paid_days), 0),
    unpaidDays:  yearlyLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0),
    deduction:   Math.round(yearlyLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0) * dayRate),
  };

  return (
    <AppShell title="Payroll" subtitle="Salary and leave deductions">
      <div className="space-y-6">

        {/* Yearly overview strip */}
        {yearlyLeaves.length > 0 && (
          <div className="rounded-xl border border-border bg-gradient-to-r from-muted/60 to-muted/20 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{filterYear} Overview</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-2xl font-extrabold">{yearlyTotals.totalDays}</p>
                <p className="text-xs text-muted-foreground">Total leave days</p>
              </div>
              <div>
                <p className="text-2xl font-extrabold text-success">{yearlyTotals.paidDays}</p>
                <p className="text-xs text-muted-foreground">Paid days</p>
              </div>
              <div>
                <p className={`text-2xl font-extrabold ${yearlyTotals.unpaidDays > 0 ? "text-destructive" : "text-success"}`}>{yearlyTotals.unpaidDays}</p>
                <p className="text-xs text-muted-foreground">Unpaid days</p>
              </div>
              <div>
                <p className={`text-2xl font-extrabold ${yearlyTotals.deduction > 0 ? "text-destructive" : "text-success"}`}>
                  {yearlyTotals.deduction > 0 ? `−${money(yearlyTotals.deduction)}` : "₹0"}
                </p>
                <p className="text-xs text-muted-foreground">Total deduction</p>
              </div>
            </div>
          </div>
        )}

        {/* Filters + download */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-24 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-0.5 rounded-lg border border-border px-1 h-9">
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => {
                const prev = new Date(Number(filterYear), month.getMonth() - 1, 1);
                setMonth(prev);
                // If navigating across a year boundary, update filterYear too
                if (prev.getFullYear() !== Number(filterYear)) setFilterYear(String(prev.getFullYear()));
              }}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="text-sm font-medium w-20 text-center">
              {effectiveMonth.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => {
                const next = new Date(Number(filterYear), month.getMonth() + 1, 1);
                setMonth(next);
                if (next.getFullYear() !== Number(filterYear)) setFilterYear(String(next.getFullYear()));
              }}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="flex-1 min-w-[140px] h-9 text-sm"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All leave types</SelectItem>
              {LEAVE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="ml-auto flex items-center gap-1.5" onClick={downloadPayslip}>
            <Download className="size-4" /> Download Payslip
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Monthly Salary" value={money(salary)} hint={`${money(dayRate)}/day`} />
          <StatCard label="Paid Days" value={totals.paid} tone="success" hint="no deduction" />
          <StatCard label="Unpaid Days" value={totals.unpaid} tone={totals.unpaid > 0 ? "destructive" : "success"} hint="salary cut" />
          <StatCard
            label="Net Pay"
            value={money(totals.net)}
            tone={totals.deduction > 0 ? "warning" : "success"}
            hint={totals.deduction > 0 ? `−${money(totals.deduction)}` : "full salary"}
          />
        </div>

        {/* Donut chart — only when there's a deduction */}
        {totals.deduction > 0 && chartData.length > 1 && (
          <SectionCard title="Salary split" subtitle="Net pay vs deduction">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number) => money(v)}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--foreground)" }}
                />
                <Legend formatter={(value) => <span className="text-xs text-foreground">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </SectionCard>
        )}

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
            <div className="space-y-3">
              {leaves.map((l) => {
                const isAwaitingDecision =
                  l.payment_decision === null && l.leave_type !== "casual";
                const awaitingLabel =
                  l.leave_type === "medical" || l.leave_type === "duty"
                    ? "Awaiting document verification"
                    : "Awaiting principal approval";
                const deductionAmt = Number(l.unpaid_days) * dayRate;

                return (
                  <div key={l.id} className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2.5">
                    {/* Row 1: leave type + status badge */}
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm">{leaveTypeLabel(l.leave_type as LeaveType)}</p>
                      <StatusBadge status={l.status as LeaveStatus} />
                    </div>

                    {/* Row 2: dates + days */}
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{fmtDate(l.from_date)} – {fmtDate(l.to_date)}</span>
                      <span className="font-medium text-foreground">{Number(l.total_days)} day{Number(l.total_days) !== 1 ? "s" : ""}</span>
                    </div>

                    {/* Row 3: paid/unpaid + deduction */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      {isAwaitingDecision ? (
                        <span className="text-muted-foreground italic">{awaitingLabel}</span>
                      ) : (
                        <span>
                          <span className="text-success font-medium">{Number(l.paid_days)} paid</span>
                          <span className="text-muted-foreground mx-1">·</span>
                          <span className="text-destructive font-medium">{Number(l.unpaid_days)} unpaid</span>
                        </span>
                      )}
                      {!isAwaitingDecision && Number(l.unpaid_days) > 0 ? (
                        <span className="font-semibold text-destructive">− {money(deductionAmt)}</span>
                      ) : (
                        !isAwaitingDecision && <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
