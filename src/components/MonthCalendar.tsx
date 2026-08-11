import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { eachDate, leaveTypeLabel, type LeaveType } from "@/lib/leave";

export type DayKind =
  | "sunday"
  | "holiday"
  | "leave_paid"
  | "leave_unpaid"
  | "leave_pending"
  | "present"
  | "future";

interface DayCell {
  date: string;
  day: number;
  kind: DayKind;
  note?: string;
  /** Extra detail shown only in the tap card */
  detail?: string;
}

const KIND_CLASS: Record<DayKind, string> = {
  sunday:        "bg-destructive/10 text-destructive border-destructive/20",
  holiday:       "bg-info/12 text-info border-info/30",
  leave_paid:    "bg-warning/20 text-warning-foreground border-warning/40",
  leave_unpaid:  "bg-destructive/12 text-destructive border-destructive/30",
  leave_pending: "bg-warning/10 text-warning-foreground border-warning/40 border-dashed",
  present:       "bg-success/12 text-success border-success/30",
  future:        "bg-card text-muted-foreground",
};

const KIND_LABEL: Record<DayKind, string> = {
  sunday:        "Weekly Off",
  holiday:       "Holiday",
  leave_paid:    "On Leave (Paid)",
  leave_unpaid:  "On Leave (Unpaid)",
  leave_pending: "On Leave (Pending Approval)",
  present:       "Present",
  future:        "—",
};

const KIND_ICON: Record<DayKind, string> = {
  sunday:        "🌅",
  holiday:       "🎉",
  leave_paid:    "🌴",
  leave_unpaid:  "📋",
  leave_pending: "⏳",
  present:       "✅",
  future:        "📅",
};

const LEGEND: { kind: DayKind; label: string }[] = [
  { kind: "present",       label: "Present" },
  { kind: "leave_pending", label: "Pending leave" },
  { kind: "leave_paid",    label: "Paid leave" },
  { kind: "leave_unpaid",  label: "Unpaid leave" },
  { kind: "holiday",       label: "Holiday" },
  { kind: "sunday",        label: "Sunday" },
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Bottom-sheet day detail card shown on mobile tap */
function DayDetailCard({ cell, onClose }: { cell: DayCell; onClose: () => void }) {
  const d = new Date(cell.date + "T00:00:00");
  const dayName  = DAY_NAMES[d.getDay()];
  const dateStr  = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      {/* Card slides up from bottom */}
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-background border-t border-border shadow-2xl p-5 pb-8">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{dayName}</p>
            <p className="text-lg font-extrabold">{dateStr}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Status pill */}
        <div className={cn(
          "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-transparent",
          KIND_CLASS[cell.kind],
        )}>
          <span>{KIND_ICON[cell.kind]}</span>
          <span>{KIND_LABEL[cell.kind]}</span>
        </div>

        {/* Note / holiday name / leave type */}
        {cell.note && cell.kind !== "present" && (
          <p className="mt-3 text-sm text-muted-foreground">{cell.note}</p>
        )}

        {/* Extra detail (leave type + status) */}
        {cell.detail && (
          <p className="mt-1 text-xs text-muted-foreground">{cell.detail}</p>
        )}
      </div>
    </>
  );
}

export function MonthCalendar({
  teacherId,
  monthDate,
  onMonthChange,
}: {
  teacherId: string | undefined;
  monthDate?: Date;
  onMonthChange?: (d: Date) => void;
}) {
  const [internal, setInternal] = useState(
    () => monthDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const month = onMonthChange && monthDate ? monthDate : internal;
  const setMonth = onMonthChange ?? setInternal;

  const [selectedCell, setSelectedCell] = useState<DayCell | null>(null);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last  = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const fromISO = iso(first);
  const toISO   = iso(last);

  const { data } = useQuery({
    queryKey: ["month-calendar", teacherId, fromISO],
    enabled: !!teacherId,
    queryFn: async () => {
      const [holidays, leaves] = await Promise.all([
        supabase
          .from("holidays")
          .select("holiday_date, occasion")
          .gte("holiday_date", fromISO)
          .lte("holiday_date", toISO),
        supabase
          .from("leave_requests")
          .select("from_date, to_date, leave_type, status, unpaid_days, total_days")
          .eq("teacher_id", teacherId!)
          .neq("status", "rejected")
          .lte("from_date", toISO)
          .gte("to_date", fromISO),
      ]);
      if (holidays.error) throw holidays.error;
      if (leaves.error)   throw leaves.error;
      return { holidays: holidays.data ?? [], leaves: leaves.data ?? [] };
    },
  });

  const cells = useMemo<DayCell[]>(() => {
    const holidayMap = new Map((data?.holidays ?? []).map((h) => [h.holiday_date, h.occasion]));
    const leaveMap = new Map<string, { pending: boolean; unpaid: boolean; label: string; detail: string }>();

    for (const l of data?.leaves ?? []) {
      const unpaid  = Number(l.unpaid_days) > 0;
      const pending = l.status === "pending_hod";
      const typeLabel = leaveTypeLabel(l.leave_type as LeaveType);
      const statusLabel = pending ? "Pending HOD approval" : unpaid ? "Unpaid" : "Paid";
      for (const d of eachDate(l.from_date, l.to_date)) {
        leaveMap.set(d, {
          pending,
          unpaid,
          label:  `${typeLabel} · ${statusLabel}`,
          detail: `Leave type: ${typeLabel} · Status: ${statusLabel}`,
        });
      }
    }

    const today = iso(new Date());
    const out: DayCell[] = [];
    for (let d = 1; d <= last.getDate(); d++) {
      const date  = new Date(month.getFullYear(), month.getMonth(), d);
      const key   = iso(date);
      const leave   = leaveMap.get(key);
      const holiday = holidayMap.get(key);
      let kind: DayKind;
      let note: string | undefined;
      let detail: string | undefined;

      if (leave) {
        kind   = leave.pending ? "leave_pending" : leave.unpaid ? "leave_unpaid" : "leave_paid";
        note   = leave.label;
        detail = leave.detail;
      } else if (holiday) {
        kind = "holiday";
        note = holiday;
      } else if (date.getDay() === 0) {
        kind = "sunday";
        note = "Weekly off";
      } else if (key <= today) {
        kind = "present";
        note = "Present";
      } else {
        kind = "future";
      }
      out.push({ date: key, day: d, kind, note, detail });
    }
    return out;
  }, [data, month, last]);

  const summary = useMemo(() => {
    const count = (k: DayKind) => cells.filter((c) => c.kind === k).length;
    return {
      present:  count("present"),
      paid:     count("leave_paid"),
      unpaid:   count("leave_unpaid"),
      pending:  count("leave_pending"),
      holidays: count("holiday"),
    };
  }, [cells]);

  const leadingBlanks = first.getDay();

  return (
    <div>
      {/* Month nav */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-bold">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <Button variant="ghost" size="icon" aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className={`py-1 ${d === "Sun" ? "text-destructive" : ""}`}>{d}</span>
        ))}
      </div>

      {/* Day cells */}
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {cells.map((c) => (
          <button
            key={c.date}
            type="button"
            title={c.note}
            onClick={() => setSelectedCell(c)}
            className={cn(
              "relative flex flex-col items-center justify-start rounded-md border border-transparent text-xs font-semibold pt-1 pb-0.5 min-h-[2.5rem] cursor-pointer transition-opacity active:opacity-70",
              KIND_CLASS[c.kind],
            )}
          >
            <span>{c.day}</span>
            {/* Holiday name — desktop only */}
            {c.kind === "holiday" && c.note && (
              <span className="hidden sm:block w-full text-center leading-tight px-0.5 truncate text-[8px] opacity-80 font-normal mt-0.5">
                {c.note}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Legend */}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <li key={l.kind} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm border border-transparent", KIND_CLASS[l.kind])} />
            {l.label}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted-foreground">
        {summary.present} present · {summary.paid} paid leave · {summary.unpaid} unpaid ·{" "}
        {summary.pending} pending · {summary.holidays} holiday(s) this month
      </p>

      {/* Tap-to-detail bottom sheet (mobile) */}
      {selectedCell && (
        <DayDetailCard cell={selectedCell} onClose={() => setSelectedCell(null)} />
      )}
    </div>
  );
}
