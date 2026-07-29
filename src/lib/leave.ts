export type LeaveType = "casual" | "maternity" | "bereavement" | "other" | "emergency" | "medical" | "duty";
export type LeaveSession = "full_day" | "forenoon" | "afternoon";
export type LeaveStatus =
  | "pending_hod"
  | "hod_recommended"
  | "pending_principal"
  | "hod_approved"
  | "approved"
  | "rejected";

export type DocStatus = "required" | "uploaded" | "verified";

export const LEAVE_TYPES: { value: LeaveType; label: string; yearly: number; monthly?: number; hodFinal?: boolean; docRequired?: boolean; docLabel?: string }[] = [
  { value: "casual", label: "Casual Leave", yearly: 12, monthly: 2 },
  { value: "maternity", label: "Maternity Leave", yearly: 90 },
  { value: "bereavement", label: "Bereavement Leave", yearly: 5 },
  { value: "other", label: "Other Leave", yearly: 7 },
  { value: "emergency", label: "Emergency Leave", yearly: 6 },
  {
    value: "medical",
    label: "Medical Leave",
    yearly: 15,
    hodFinal: true,
    docRequired: true,
    docLabel: "Medical Certificate",
  },
  {
    value: "duty",
    label: "Duty Leave",
    yearly: 30,
    hodFinal: true,
    docRequired: true,
    docLabel: "Proof of Duty",
  },
];

/** Returns true if this leave type is approved by HOD alone (no principal sign-off on the leave itself) */
export const isHodFinalLeave = (t: LeaveType) =>
  LEAVE_TYPES.find((x) => x.value === t)?.hodFinal ?? false;

/** Returns the document label required for this leave type, or null */
export const docLabel = (t: LeaveType) =>
  LEAVE_TYPES.find((x) => x.value === t)?.docLabel ?? null;

export const leaveTypeLabel = (t: LeaveType) =>
  LEAVE_TYPES.find((x) => x.value === t)?.label ?? t;

export const SESSION_LABEL: Record<LeaveSession, string> = {
  full_day: "Full Day",
  forenoon: "Half Day (Forenoon)",
  afternoon: "Half Day (Afternoon)",
};

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending_hod: "Pending with HOD",
  hod_recommended: "HOD Recommended",
  pending_principal: "Pending with Principal",
  hod_approved: "Approved",
  approved: "Approved",
  rejected: "Rejected",
};

export function statusClasses(status: LeaveStatus) {
  switch (status) {
    case "approved":
    case "hod_approved":
      return "bg-success/12 text-success border-success/25";
    case "hod_recommended":
    case "pending_principal":
      return "bg-info/12 text-info border-info/25";
    case "rejected":
      return "bg-destructive/12 text-destructive border-destructive/25";
    default:
      return "bg-warning/18 text-warning-foreground border-warning/35";
  }
}

/** Emergency leave auto-approves 5 hours after submission; always unpaid. */
export const EMERGENCY_AUTO_APPROVE_MS = 5 * 60 * 60 * 1000;

/** Returns ms remaining until auto-approval, or 0 if already past. */
export function emergencyMsRemaining(createdAt: string): number {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, EMERGENCY_AUTO_APPROVE_MS - elapsed);
}

/** Format ms as "Xh Ym" */
export function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function eachDate(from: string, to: string) {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Leave types a teacher tracks a monthly quota for (shown on the dashboard). */
export const QUOTA_LEAVE_TYPES: LeaveType[] = ["casual"];

/** Types where the HOD must choose paid or unpaid before any salary effect. */
export const needsPaymentDecision = (t: LeaveType) => t !== "casual" && t !== "emergency";

/** Emergency leave is always unpaid — no quota consumed, salary always cut. */
export const isAlwaysUnpaid = (t: LeaveType) => t === "emergency";

/** Salary is prorated over a standard 30-day month. */
export const perDaySalary = (monthlySalary: number) => monthlySalary / 30;

export function money(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}
