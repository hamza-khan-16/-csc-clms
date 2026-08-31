export type LeaveType = "casual" | "maternity" | "bereavement" | "medical" | "duty";
export type LeaveSession = "full_day" | "forenoon" | "afternoon";
export type LeaveStatus =
  | "pending_hod"
  | "hod_recommended"
  | "pending_principal"
  | "hod_approved"
  | "approved"
  | "rejected"
  | "cancelled";

export type DocStatus = "required" | "uploaded" | "verified";

export const LEAVE_TYPES: { value: LeaveType; label: string; yearly: number; monthly?: number; hodFinal?: boolean; docRequired?: boolean; docLabel?: string; info?: string }[] = [
  { value: "casual",      label: "Casual Leave",      yearly: 12, monthly: 2, info: "2/month · 12/year · paid" },
  { value: "maternity",   label: "Maternity Leave",   yearly: 90,             info: "Up to 90 days" },
  { value: "bereavement", label: "Bereavement Leave", yearly: 5,              info: "Up to 5 days" },
  {
    value: "medical",
    label: "Medical Leave",
    yearly: 15,
    // NOT hodFinal — approval flow depends on number of days (see isMedicalHodFinal helper)
    docRequired: true,
    docLabel: "Medical Certificate",
    info: "≤3 days: HOD+Principal · >3 days: HOD approves, doc needed",
  },
  {
    value: "duty",
    label: "Duty Leave",
    yearly: 30,
    hodFinal: true,
    docRequired: true,
    docLabel: "Proof of Duty",
    info: "HOD approved · doc required",
  },
];

/**
 * For medical leave:
 * - ≤ 3 days → no doc required, needs both HOD recommendation AND principal approval
 * - > 3 days → doc required, HOD can directly approve (hod_approved), but doc must
 *   be uploaded for principal to verify
 */
export function getMedicalFlow(days: number): {
  docRequired: boolean;
  hodFinal: boolean;
  description: string;
} {
  if (days <= 3) {
    return {
      docRequired: false,
      hodFinal: false,
      description: "No document required · HOD recommends → Principal gives final approval",
    };
  }
  return {
    docRequired: true,
    hodFinal: true,
    description: "Medical certificate required · HOD approves directly · upload doc for principal verification",
  };
}

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
  cancelled: "Withdrawn",
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
    case "cancelled":
      return "bg-muted text-muted-foreground border-muted";
    default:
      return "bg-warning/18 text-warning-foreground border-warning/35";
  }
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

/**
 * Returns all dates from `from` to `to` inclusive (YYYY-MM-DD strings).
 * Uses integer arithmetic to avoid timezone drift so 12/08 → 17/08 gives
 * exactly 6 dates: 12, 13, 14, 15, 16, 17.
 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  // Parse as local-midnight to avoid UTC-offset shifts
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end   = new Date(ty, tm - 1, td);
  // Clone start so we don't mutate it
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, "0");
    const dy = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${mo}-${dy}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Leave types a teacher tracks a monthly quota for (shown on the dashboard). */
export const QUOTA_LEAVE_TYPES: LeaveType[] = ["casual"];

/** Types where the HOD must choose paid or unpaid before any salary effect. */
export const needsPaymentDecision = (t: LeaveType) => t !== "casual";

/**
 * Number of medical leave days a teacher gets fully paid per year without
 * any principal decision required. Days beyond this quota require the
 * principal to decide paid or unpaid on each leave request.
 */
export const MEDICAL_PAID_QUOTA = 10;

/**
 * Given how many medical leave days a teacher has already taken this year
 * (approved/hod_approved, not rejected), and the number of days in the
 * current request, return how many of those days are within the paid quota
 * (auto-paid) vs how many are over-quota (principal decides).
 */
export function medicalPaidSplit(
  alreadyTakenThisYear: number,
  requestDays: number,
): { withinQuota: number; overQuota: number } {
  const remaining = Math.max(0, MEDICAL_PAID_QUOTA - alreadyTakenThisYear);
  const withinQuota = Math.min(requestDays, remaining);
  const overQuota = requestDays - withinQuota;
  return { withinQuota, overQuota };
}

/**
 * Returns true when the principal needs to make a paid/unpaid decision for
 * a medical leave (i.e. it has days beyond the 10-day paid quota).
 */
export function medicalNeedsDecision(
  alreadyTakenThisYear: number,
  requestDays: number,
): boolean {
  return alreadyTakenThisYear + requestDays > MEDICAL_PAID_QUOTA;
}

/** Salary is prorated over a standard 30-day month. */
export const perDaySalary = (monthlySalary: number) => monthlySalary / 30;

export function money(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Compute leave days applying the SANDWICH RULE.
 *
 * Sundays and public holidays sandwiched between two working leave days are
 * counted as leave days (they cannot be used to "extend" leave for free).
 *
 * Leading / trailing non-working days that have no working day on the other
 * side are trimmed and reported in `skipped`.
 *
 * Examples (W = working, S = Sunday, H = holiday):
 *   Sat W W S W W  → sandwich S → 5 days, 0 skipped
 *   S W W S W W    → leading S trimmed → 4 days, 1 skipped
 *   W W S          → trailing S trimmed → 2 days, 1 skipped
 *   W H W          → sandwich H → 3 days, 0 skipped
 *   S only         → purelyNonWorking = true → 0 days (cannot apply)
 *
 * Pay-cut note: when a leave is marked unpaid, `total` is the number of days
 * deducted from salary — including any sandwiched Sundays / holidays.
 */
export function countWorkingDays(
  from: string,
  to: string,
  session: LeaveSession,
  holidaySet: Set<string>,
): { total: number; skipped: number; workingDates: string[]; purelyNonWorking: boolean } {
  const allDates = eachDate(from, to);
  if (allDates.length === 0) return { total: 0, skipped: 0, workingDates: [], purelyNonWorking: true };

  const isNonWorking = (d: string) =>
    new Date(d + "T00:00:00").getDay() === 0 || holidaySet.has(d);

  // Entire range is Sundays/holidays — cannot apply for this
  if (allDates.every(isNonWorking)) {
    return { total: 0, skipped: allDates.length, workingDates: [], purelyNonWorking: true };
  }

  // Find the first and last working day in the range
  const firstWorking = allDates.findIndex((d) => !isNonWorking(d));
  const lastWorking  = allDates.length - 1 - [...allDates].reverse().findIndex((d) => !isNonWorking(d));

  // Everything between first and last working day is counted (sandwich rule)
  const sandwichedDates = allDates.slice(firstWorking, lastWorking + 1);
  const skipped = allDates.length - sandwichedDates.length;

  // workingDates = only actual working days (used for proxy assignments)
  const workingDates = sandwichedDates.filter((d) => !isNonWorking(d));

  let total = sandwichedDates.length;
  if (session !== "full_day") total = Math.min(total, 1) * 0.5;

  return { total, skipped, workingDates, purelyNonWorking: false };
}
