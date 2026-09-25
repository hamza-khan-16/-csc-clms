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
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
// jsPDF loaded dynamically inside export functions to keep initial bundle lean.
import { savePDF, saveXLSX } from "../lib/download";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
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
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));

// Donut chart with pop-out slice animation on hover/click — no border box
function SalaryDonut({ chartData, moneyFmt }: { chartData: { name: string; value: number; color: string }[]; moneyFmt: (v: number) => string }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const RADIAN = Math.PI / 180;
  function makeArcPath(cx: number, cy: number, innerR: number, outerR: number, startAngle: number, endAngle: number) {
    const x1 = cx + outerR * Math.cos(-startAngle * RADIAN);
    const y1 = cy + outerR * Math.sin(-startAngle * RADIAN);
    const x2 = cx + outerR * Math.cos(-endAngle * RADIAN);
    const y2 = cy + outerR * Math.sin(-endAngle * RADIAN);
    const x3 = cx + innerR * Math.cos(-endAngle * RADIAN);
    const y3 = cy + innerR * Math.sin(-endAngle * RADIAN);
    const x4 = cx + innerR * Math.cos(-startAngle * RADIAN);
    const y4 = cy + innerR * Math.sin(-startAngle * RADIAN);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 0 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 1 ${x4} ${y4} Z`;
  }

  const activeShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <path
        d={makeArcPath(cx, cy, innerRadius - 2, outerRadius + 8, startAngle, endAngle)}
        fill={fill}
        stroke="none"
        style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.28))", transition: "d 0.2s ease" }}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          dataKey="value"
          paddingAngle={3}
          activeIndex={activeIdx ?? undefined}
          activeShape={activeShape}
          onMouseEnter={(_, idx) => setActiveIdx(idx)}
          onMouseLeave={() => setActiveIdx(null)}
          onClick={(_, idx) => setActiveIdx(activeIdx === idx ? null : idx)}
          stroke="none"
          isAnimationActive={true}
        >
          {chartData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
        </Pie>
        <Tooltip
          formatter={(v: number) => moneyFmt(v)}
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--foreground)" }}
        />
        <Legend formatter={(value) => <span className="text-xs text-foreground">{value}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function PayrollPage() {
  const t = useT();
    const { profile, role } = useAuth();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [filterYear, setFilterYear] = useState(String(CURRENT_YEAR));
  const [ytdOpen, setYtdOpen] = useState(false); // collapsed by default
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
        .select("leave_type, total_days, paid_days, unpaid_days, payment_decision, hod_acted_at, principal_acted_at, status, from_date, to_date")
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

  // YTD month-by-month breakdown
  const ytdRows = useMemo(() => {
    if (!salary) return [];
    const fy = parseInt(filterYear, 10);
    if (!fy || isNaN(fy)) return [];
    const currentYear = new Date().getFullYear();
    const currentMonth = fy === currentYear ? new Date().getMonth() : 11;
    return Array.from({ length: currentMonth + 1 }, (_, m) => {
      const monthStart = `${fy}-${String(m + 1).padStart(2, "0")}-01`;
      const monthEnd   = new Date(fy, m + 1, 0).toISOString().slice(0, 10);
      const monthLeaves = yearlyLeaves.filter(l =>
        l.from_date <= monthEnd && l.to_date >= monthStart &&
        ["approved","hod_approved"].includes(l.status)
      );
      // Only count unpaid days where the principal has made a final paid/unpaid decision.
      // payment_decision null = still awaiting the principal's call — no deduction yet.
      const unpaidDays = monthLeaves.filter((l: any) => l.payment_decision !== null).reduce((s: number, l: any) => s + Number(l.unpaid_days ?? 0), 0);
      // Use salary/30 (same as perDaySalary) for consistency with the totals panel and hr.tsx
      const deduction  = Math.round(dayRate * unpaidDays);
      return { month: m, unpaidDays, deduction, net: salary - deduction };
    });
  }, [yearlyLeaves, salary, filterYear, dayRate]);

  const totals = useMemo(() => {
    // Only deduct for leaves that have BOTH HOD and Principal approval

    const fullyApproved = leaves.filter((l) => {

      const isHodFinal = l.leave_type === "medical" || l.leave_type === "duty";
      // Medical/duty: deduction applies once principal has verified the document and set payment_decision
      if (isHodFinal) return !!(l as any).payment_decision;
      return !!(l as any).hod_acted_at && !!(l as any).principal_acted_at;
    });
    const unpaid = fullyApproved.reduce((s, l) => s + Number(l.unpaid_days), 0);
    // Calculate actual working days in the month (excluding Sundays)
    // paid = working days in month - unpaid leave days
    const daysInMonth = new Date(effectiveMonth.getFullYear(), effectiveMonth.getMonth() + 1, 0).getDate();
    let workingDaysInMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(effectiveMonth.getFullYear(), effectiveMonth.getMonth(), d).getDay();
      if (day !== 0) workingDaysInMonth++; // exclude Sundays
    }
    const paid = Math.max(workingDaysInMonth - Math.round(unpaid), 0);
    const deduction = Math.round(unpaid * dayRate);
    return { unpaid, paid, deduction, net: Math.max(salary - deduction, 0), fullyApproved };
  }, [leaves, dayRate, salary]);

  const chartData = [
    { name: "Net Pay", value: totals.net, color: "#22c55e" },
    { name: "Deduction", value: totals.deduction, color: "#ef4444" },
  ].filter((d) => d.value > 0);

  async function downloadPayslip() {
    const { jsPDF } = await import("jspdf");
    const { autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const PW = doc.internal.pageSize.getWidth();   // 210
    const PH = doc.internal.pageSize.getHeight();  // 297
    const month = effectiveMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    // PDF-safe money formatter — jsPDF's built-in Helvetica cannot render ₹ (U+20B9)
    // so we use "Rs." which renders perfectly
    function pdfMoney(amount: number): string {
      const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(amount));
      return `Rs. ${formatted}`;
    }

    // ── Fetch logo ──────────────────────────────────────────────────────────
    let logoB64: string | null = null;
    try {
      const res = await fetch("/csc-logo.png");
      const blob = await res.blob();
      logoB64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      });
    } catch { /* skip */ }

    // ── Letterhead ──────────────────────────────────────────────────────────
    const HEADER_H = 38;
    doc.setFillColor(248, 248, 248);
    doc.rect(0, 0, PW, HEADER_H, "F");
    doc.setDrawColor(234, 88, 12);
    doc.setLineWidth(0.8);
    doc.line(0, HEADER_H, PW, HEADER_H);

    if (logoB64) {
      doc.addImage(logoB64, "PNG", 10, (HEADER_H - 16) / 2, 26, 16);
    }

    const CX = PW / 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    doc.text("Smt. Durgadevi Sharma Charitable Trust's", CX, 8, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text("Chandrabhan Sharma College", CX, 15, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    doc.text("Of Arts, Commerce & Science  (AUTONOMOUS)", CX, 20, { align: "center" });
    doc.text("(Hindi Linguistic Minority Institution)  ·  (Affiliated to the University of Mumbai)", CX, 24.5, { align: "center" });
    doc.text("NAAC Re-Accredited 'A' Grade (CGPA 3.10)", CX, 29, { align: "center" });

    // ── Payslip title bar ───────────────────────────────────────────────────
    doc.setFillColor(30, 30, 30);
    doc.rect(0, HEADER_H + 1, PW, 9, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("SALARY SLIP", CX, HEADER_H + 6.5, { align: "center" });
    doc.setFontSize(7.5);
    doc.setTextColor(200, 200, 200);
    doc.text(`For the Month of ${month}`, PW - 12, HEADER_H + 6.5, { align: "right" });

    // ── Employee details box ────────────────────────────────────────────────
    const BOX_Y = HEADER_H + 14;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.roundedRect(12, BOX_Y, PW - 24, 26, 2, 2, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    const col1X = 18;
    const col2X = 80;
    const col3X = 140;

    // Row 1
    doc.text("Employee Name", col1X, BOX_Y + 6);
    doc.text("Department", col2X, BOX_Y + 6);
    doc.text("Pay Period", col3X, BOX_Y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    doc.text(profile?.full_name ?? "—", col1X, BOX_Y + 11.5);
    doc.text(profile?.department_name ?? "—", col2X, BOX_Y + 11.5);
    doc.text(month, col3X, BOX_Y + 11.5);

    // Divider
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.2);
    doc.line(18, BOX_Y + 14, PW - 18, BOX_Y + 14);

    // Row 2
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text("Designation", col1X, BOX_Y + 19);
    doc.text("Gross Salary", col2X, BOX_Y + 19);
    doc.text("Generated On", col3X, BOX_Y + 19);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    const designation = role === "hod" ? "Head of Department" : "Teacher";
    doc.text(designation, col1X, BOX_Y + 24.5);
    doc.text(pdfMoney(salary), col2X, BOX_Y + 24.5);
    doc.text(new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), col3X, BOX_Y + 24.5);

    // ── Earnings & Deductions table ─────────────────────────────────────────
    const TABLE_Y = BOX_Y + 32;

    autoTable(doc, {
      startY: TABLE_Y,
      margin: { left: 12, right: 12 },
      head: [["Earnings", "Amount (Rs.)", "Deductions", "Amount (Rs.)"]],
      body: [
        [
          "Gross Salary",
          pdfMoney(salary),
          "Unpaid Leave Days",
          String(totals.unpaid),
        ],
        [
          "Working Days (Paid)",
          String(totals.paid),
          "Leave Deduction",
          totals.deduction > 0 ? `- ${pdfMoney(totals.deduction)}` : "—",
        ],
        ["", "", "", ""],
      ],
      styles: { fontSize: 8.5, cellPadding: 3.5 },
      headStyles: { fillColor: [50, 50, 50], textColor: 255, fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: "bold" },
        1: { cellWidth: 40, halign: "right" },
        2: { cellWidth: 55, fontStyle: "bold" },
        3: { cellWidth: 40, halign: "right" },
      },
      alternateRowStyles: { fillColor: [252, 252, 252] },
    });

    const afterTable = (doc as any).lastAutoTable.finalY + 4;

    // ── Net pay highlight box ───────────────────────────────────────────────
    const NET_H = 14;
    doc.setFillColor(234, 88, 12);
    doc.roundedRect(12, afterTable, PW - 24, NET_H, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text("NET PAY", 22, afterTable + NET_H / 2 + 1.5);
    doc.setFontSize(12);
    doc.text(pdfMoney(totals.net), PW - 20, afterTable + NET_H / 2 + 1.5, { align: "right" });

    // ── Leave breakdown ─────────────────────────────────────────────────────
    if (totals.fullyApproved.length > 0) {
      const LV_Y = afterTable + NET_H + 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text("Leave Breakdown", 12, LV_Y);
      autoTable(doc, {
        startY: LV_Y + 3,
        margin: { left: 12, right: 12 },
        head: [["Leave Type", "From", "To", "Total Days", "Unpaid Days", "Deduction"]],
        body: totals.fullyApproved.map((l) => [
          leaveTypeLabel(l.leave_type as LeaveType),
          fmtDate(l.from_date),
          fmtDate(l.to_date),
          String(l.total_days),
          String(l.unpaid_days),
          l.unpaid_days > 0 ? `- ${pdfMoney(Math.round(Number(l.unpaid_days) * dayRate))}` : "—",
        ]),
        styles: { fontSize: 7.5, cellPadding: 2.5 },
        headStyles: { fillColor: [70, 70, 70], textColor: 255, fontStyle: "bold", fontSize: 7 },
        alternateRowStyles: { fillColor: [252, 252, 252] },
      });
    }

    // ── Signature strip ─────────────────────────────────────────────────────
    const SIG_Y = PH - 30;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(12, SIG_Y, PW - 12, SIG_Y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);

    // Employee signature
    doc.text("Employee's Signature", 16, SIG_Y + 5);
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.4);
    doc.line(16, SIG_Y + 14, 75, SIG_Y + 14);
    doc.setFontSize(6.5);
    doc.text(profile?.full_name ?? "", 16, SIG_Y + 18);

    // Accounts signature
    doc.setFontSize(7);
    doc.text("Accounts / HR", PW / 2 - 15, SIG_Y + 5);
    doc.line(PW / 2 - 15, SIG_Y + 14, PW / 2 + 25, SIG_Y + 14);
    doc.setFontSize(6.5);
    doc.text("Accounts Department", PW / 2 - 15, SIG_Y + 18);

    // Principal signature
    doc.setFontSize(7);
    doc.text("Principal's Signature", PW - 75, SIG_Y + 5);
    doc.line(PW - 75, SIG_Y + 14, PW - 14, SIG_Y + 14);
    doc.setFontSize(6.5);
    doc.text("Principal, Chandrabhan Sharma College", PW - 75, SIG_Y + 18);

    // Footer note
    doc.setFontSize(6);
    doc.setTextColor(170, 170, 170);
    doc.text("This is a computer-generated payslip. No signature required if issued electronically.", CX, PH - 6, { align: "center" });
    doc.text(`Page 1`, CX, PH - 3, { align: "center" });

    // QR code — encodes a verification string with key payslip details
    // Scannable by anyone to confirm authenticity without logging in
    try {
      const QRCode = await import("qrcode");
      const verificationText = [
        `CSC LMS Payslip`,
        `Employee: ${profile?.full_name ?? ""}`,
        `Period: ${month}`,
        `Gross: Rs. ${salary}`,
        `Net Pay: Rs. ${totals.net}`,
        `Generated: ${new Date().toLocaleDateString("en-IN")}`,
        `Verify at: ${window.location.origin}/verify-payslip`,
      ].join("\n");
      const qrDataUrl = await QRCode.toDataURL(verificationText, { width: 80, margin: 1 });
      // Place QR at bottom-right corner
      doc.addImage(qrDataUrl, "PNG", PW - 30, PH - 32, 18, 18);
      doc.setFontSize(5);
      doc.setTextColor(150, 150, 150);
      doc.text("Scan to verify", PW - 21, PH - 13, { align: "center" });
    } catch (_) { /* QR is non-critical — skip if it fails */ }

    const safeName = (profile?.full_name ?? "payslip").split(" ").join("_");
    const safePeriod = month.replace(" ", "_");
    await savePDF(doc, `Payslip_${safeName}_${safePeriod}.pdf`);
  }

  // For yearly overview: only count leaves where the principal has made a final paid/unpaid decision.
  const decidedYearlyLeaves = yearlyLeaves.filter((l: any) => l.payment_decision !== null);
  const yearlyTotals = {
    totalDays:   yearlyLeaves.reduce((s, l) => s + Number(l.total_days), 0),
    paidDays:    decidedYearlyLeaves.reduce((s, l) => s + Number(l.paid_days), 0),
    unpaidDays:  decidedYearlyLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0),
    deduction:   Math.round(decidedYearlyLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0) * dayRate),
  };

  return (
    <AppShell title={t("nav.payroll")} subtitle="Salary and leave deductions">
      <div className="space-y-6">

        {/* Year-to-date month-by-month breakdown — collapsible */}
        {salary > 0 && ytdRows.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header — always visible, click to toggle */}
            <button
              onClick={() => setYtdOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
            >
              <div>
                <p className="text-sm font-semibold">Year-to-Date Summary</p>
                <p className="text-xs text-muted-foreground">Month-by-month breakdown for {filterYear}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Mini summary always visible */}
                {!ytdOpen && ytdRows.some(r => r.deduction > 0) && (
                  <span className="text-xs font-semibold text-destructive tabular-nums">
                    - {money(ytdRows.reduce((s, r) => s + r.deduction, 0))} deducted
                  </span>
                )}
                {ytdOpen
                  ? <ChevronUp className="size-4 text-muted-foreground" />
                  : <ChevronDown className="size-4 text-muted-foreground" />
                }
              </div>
            </button>

            {/* Collapsible table */}
            {ytdOpen && (
              <div className="px-4 pb-4 overflow-x-auto border-t border-border">
                <table className="w-full text-sm mt-3">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Month</th>
                      <th className="pb-2 text-right font-medium">Unpaid Days</th>
                      <th className="pb-2 text-right font-medium">Deduction</th>
                      <th className="pb-2 text-right font-medium">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ytdRows.map(row => (
                      <tr key={row.month} className="border-b border-border/40 last:border-0">
                        <td className="py-2 font-medium">{MONTH_NAMES[row.month]} {filterYear}</td>
                        <td className={`py-2 text-right tabular-nums ${row.unpaidDays > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {row.unpaidDays > 0 ? row.unpaidDays : "—"}
                        </td>
                        <td className={`py-2 text-right tabular-nums ${row.deduction > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {row.deduction > 0 ? `- ${money(row.deduction)}` : "—"}
                        </td>
                        <td className="py-2 text-right font-semibold tabular-nums">{money(row.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td className="pt-2 text-xs font-semibold text-muted-foreground">YTD total</td>
                      <td className="pt-2 text-right text-xs font-semibold text-destructive tabular-nums">
                        {ytdRows.reduce((s, r) => s + r.unpaidDays, 0) || "—"}
                      </td>
                      <td className="pt-2 text-right text-xs font-semibold text-destructive tabular-nums">
                        {ytdRows.some(r => r.deduction > 0) ? `- ${money(ytdRows.reduce((s, r) => s + r.deduction, 0))}` : "—"}
                      </td>
                      <td className="pt-2 text-right text-xs font-semibold tabular-nums">
                        {money(ytdRows.reduce((s, r) => s + r.net, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

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
          <SectionCard title={t("payroll.slip")} subtitle="Net pay vs deduction">
            <SalaryDonut chartData={chartData} moneyFmt={money} />
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