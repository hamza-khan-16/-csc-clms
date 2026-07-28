import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
}

const KIND_CLASS: Record<DayKind, string> = {
  sunday: "bg-muted text-muted-foreground",
  holiday: "bg-info/12 text-info border-info/30",
  leave_paid: "bg-warning/20 text-warning-foreground border-warning/40",
  leave_unpaid: "bg-destructive/12 text-destructive border-destructive/30",
  leave_pending: "bg-warning/10 text-warning-foreground border-warning/40 border-dashed",
  present: "bg-success/12 text-success border-success/30",
  future: "bg-card text-muted-foreground",
};

const LEGEND: { kind: DayKind; label: string }[] = [
  { kind: "present", label: "Present" },
  { kind: "leave_pending", label: "Pending leave" },
  { kind: "leave_paid", label: "Paid leave" },
  { kind: "leave_unpaid", label: "Unpaid leave" },
  { kind: "holiday", label: "Holiday" },
  { kind: "sunday", label: "Sunday" },
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const fromISO = iso(first);
  const toISO = iso(last);

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
      if (leaves.error) throw leaves.error;
      return { holidays: holidays.data ?? [], leaves: leaves.data ?? [] };
    },
  });

  const cells = useMemo<DayCell[]>(() => {
    const holidayMap = new Map((data?.holidays ?? []).map((h) => [h.holiday_date, h.occasion]));
    const leaveMap = new Map<string, { pending: boolean; unpaid: boolean; label: string }>();
    for (const l of data?.leaves ?? []) {
      const unpaid = Number(l.unpaid_days) > 0;
      const pending = l.status === "pending_hod";
      for (const d of eachDate(l.from_date, l.to_date)) {
        leaveMap.set(d, {
          pending,
          unpaid,
          label: `${leaveTypeLabel(l.leave_type as LeaveType)} · ${pending ? "pending HOD approval" : unpaid ? "unpaid" : "paid"}`,
        });
      }
    }

    const today = iso(new Date());
    const out: DayCell[] = [];
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d);
      const key = iso(date);
      const leave = leaveMap.get(key);
      const holiday = holidayMap.get(key);
      let kind: DayKind;
      let note: string | undefined;
      if (leave) {
        kind = leave.pending ? "leave_pending" : leave.unpaid ? "leave_unpaid" : "leave_paid";
        note = leave.label;
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
      out.push({ date: key, day: d, kind, note });
    }
    return out;
  }, [data, month, last]);

  const summary = useMemo(() => {
    const count = (k: DayKind) => cells.filter((c) => c.kind === k).length;
    return {
      present: count("present"),
      paid: count("leave_paid"),
      unpaid: count("leave_unpaid"),
      pending: count("leave_pending"),
      holidays: count("holiday"),
    };
  }, [cells]);

  const leadingBlanks = first.getDay();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-bold">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {cells.map((c) => (
          <div
            key={c.date}
            title={c.note}
            className={cn(
              "flex aspect-square flex-col items-center justify-center rounded-md border border-transparent text-xs font-semibold",
              KIND_CLASS[c.kind],
            )}
          >
            {c.day}
          </div>
        ))}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <li key={l.kind} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm border border-transparent", KIND_CLASS[l.kind])} />
            {l.label}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted-foreground">
        {summary.present} present · {summary.paid} paid leave · {summary.unpaid} unpaid leave ·{" "}
        {summary.pending} pending · {summary.holidays} holiday(s) this month
      </p>
    </div>
  );
}
