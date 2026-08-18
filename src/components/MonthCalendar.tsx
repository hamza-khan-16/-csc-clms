import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, X, Star,
  Sunset, PartyPopper, PalmtreeIcon, ClipboardList,
  Clock, CheckCircle2, CalendarDays,
} from "lucide-react";
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

const KIND_ICON: Record<DayKind, React.ReactNode> = {
  sunday:        <Sunset       className="size-3" />,
  holiday:       <PartyPopper  className="size-3" />,
  leave_paid:    <PalmtreeIcon className="size-3" />,
  leave_unpaid:  <ClipboardList className="size-3" />,
  leave_pending: <Clock        className="size-3" />,
  present:       <CheckCircle2 className="size-3" />,
  future:        <CalendarDays className="size-3" />,
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

const DAY_NAMES   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ── Hover popover (desktop) ───────────────────────────────────────────────────
function HoverPopover({ cell, anchorRef }: { cell: DayCell; anchorRef: React.RefObject<HTMLButtonElement | null> }) {
  const [pos, setPos] = useState({ top: 0, left: 0, above: false });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const popoverH = 120; // estimated popover height
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < popoverH + 12;
    setPos({
      top:  above ? rect.top - 6 : rect.bottom + 6,
      left: Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120),
      above,
    });
  }, [anchorRef]);

  const d = new Date(cell.date + "T00:00:00");
  const dateStr = `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        top:  pos.above ? pos.top : pos.top,
        left: pos.left,
        transform: pos.above ? "translateX(-50%) translateY(-100%)" : "translateX(-50%)",
      }}
    >
      <div className="bg-popover text-popover-foreground rounded-xl shadow-xl border border-border px-3.5 py-2.5 text-xs min-w-[160px] max-w-[220px] animate-in fade-in-0 zoom-in-95 duration-150">
        <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{dateStr}</p>
        <div className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border", KIND_CLASS[cell.kind])}>
          <span>{KIND_ICON[cell.kind]}</span>
          <span>{KIND_LABEL[cell.kind]}</span>
        </div>
        {cell.note && cell.kind !== "present" && (
          <p className="mt-1.5 text-muted-foreground leading-snug">{cell.note}</p>
        )}
        {/* Arrow — top or bottom */}
        {pos.above
          ? <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-popover border-r border-b border-border" />
          : <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-popover border-l border-t border-border" />
        }
      </div>
    </div>
  );
}

// ── Click detail modal (centered) ────────────────────────────────────────────
function DayDetailCard({ cell, onClose }: { cell: DayCell; onClose: () => void }) {
  const d = new Date(cell.date + "T00:00:00");
  const dayName = DAY_NAMES[d.getDay()];
  const dateStr = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-background border border-border shadow-2xl p-5 animate-in fade-in-0 zoom-in-95 duration-200">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{dayName}</p>
              <p className="text-lg font-extrabold">{dateStr}</p>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted transition-colors" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-transparent", KIND_CLASS[cell.kind])}>
            <span>{KIND_ICON[cell.kind]}</span>
            <span>{KIND_LABEL[cell.kind]}</span>
          </div>
          {cell.note && cell.kind !== "present" && (
            <p className="mt-3 text-sm text-muted-foreground">{cell.note}</p>
          )}
          {cell.detail && (
            <p className="mt-1 text-xs text-muted-foreground">{cell.detail}</p>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ── Individual day cell ───────────────────────────────────────────────────────
function DayCell_({
  cell,
  isToday,
  onClick,
}: {
  cell: DayCell;
  isToday: boolean;
  onClick: (cell: DayCell) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isHoliday = cell.kind === "holiday";

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => onClick(cell)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "relative flex flex-col items-center justify-start rounded-lg border text-xs font-semibold pt-1 pb-0.5 min-h-[2.75rem] cursor-pointer transition-all duration-150",
          "hover:brightness-95 hover:scale-105 hover:z-10 hover:shadow-md active:scale-100",
          KIND_CLASS[cell.kind],
          // Today ring — white/dark ring around the number
          isToday && "ring-2 ring-offset-1 ring-primary shadow-md",
        )}
      >
        {/* Holiday star — top-right pip */}
        {isHoliday && (
          <Star className="absolute top-0.5 right-0.5 size-2 fill-current opacity-70" />
        )}

        {/* Day number — bold ring on today */}
        <span className={cn(
          "leading-none",
          isToday && "font-extrabold",
        )}>
          {cell.day}
        </span>

        {/* Holiday name on desktop */}
        {isHoliday && cell.note && (
          <span className="hidden sm:block w-full text-center leading-tight px-0.5 truncate text-[8px] opacity-80 font-normal mt-0.5">
            {cell.note}
          </span>
        )}
      </button>

      {/* Hover popover — desktop only (hidden on touch) */}
      {hovered && typeof window !== "undefined" && !("ontouchstart" in window) && (
        <HoverPopover cell={cell} anchorRef={ref} />
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
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
  const month    = onMonthChange && monthDate ? monthDate : internal;
  const setMonth = onMonthChange ?? setInternal;

  const [selectedCell, setSelectedCell] = useState<DayCell | null>(null);

  // ── Slide animation state ──────────────────────────────────────────────────
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [animating, setAnimating] = useState(false);

  function navigateMonth(dir: "prev" | "next") {
    if (animating) return;
    setSlideDir(dir === "next" ? "left" : "right");
    setAnimating(true);
    setTimeout(() => {
      setMonth(new Date(month.getFullYear(), month.getMonth() + (dir === "next" ? 1 : -1), 1));
      setSlideDir(null);
      setAnimating(false);
    }, 180);
  }

  // ── Touch / swipe (mobile) ─────────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return; // too small
    navigateMonth(dx < 0 ? "next" : "prev");
  }, [month, animating]); // eslint-disable-line

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
    const leaveMap   = new Map<string, { pending: boolean; unpaid: boolean; label: string; detail: string }>();

    for (const l of data?.leaves ?? []) {
      const unpaid  = Number(l.unpaid_days) > 0;
      const pending = l.status === "pending_hod";
      const typeLabel   = leaveTypeLabel(l.leave_type as LeaveType);
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
      const date    = new Date(month.getFullYear(), month.getMonth(), d);
      const key     = iso(date);
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

  const todayISO  = iso(new Date());
  const leadingBlanks = first.getDay();
  const isMobile  = typeof window !== "undefined" && "ontouchstart" in window;

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button
          variant="ghost" size="icon" aria-label="Previous month"
          onClick={() => navigateMonth("prev")}
          disabled={animating}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-bold select-none">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <Button
          variant="ghost" size="icon" aria-label="Next month"
          onClick={() => navigateMonth("next")}
          disabled={animating}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Sliding grid wrapper */}
      <div
        className="overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={cn(
            "transition-all duration-180 ease-in-out",
            animating && slideDir === "left"  && "-translate-x-4 opacity-0",
            animating && slideDir === "right" && "translate-x-4 opacity-0",
            !animating && "translate-x-0 opacity-100",
          )}
          style={{ transitionDuration: "180ms" }}
        >
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
              <span key={d} className={cn("py-1", d === "Sun" && "text-destructive")}>{d}</span>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {cells.map((c) => (
              <DayCell_
                key={c.date}
                cell={c}
                isToday={c.date === todayISO}
                onClick={(cell) => {
                  setSelectedCell(selectedCell?.date === cell.date ? null : cell);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <li key={l.kind} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm border border-transparent", KIND_CLASS[l.kind])} />
            {l.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <Star className="size-3 text-info fill-info" />
          Holiday
        </li>
      </ul>

      {/* Summary line */}
      <p className="mt-3 text-xs text-muted-foreground">
        {summary.present} present · {summary.paid} paid leave · {summary.unpaid} unpaid ·{" "}
        {summary.pending} pending · {summary.holidays} holiday(s) this month
      </p>

      {/* Swipe hint on mobile */}
      {isMobile && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center select-none flex items-center justify-center gap-1">
          <ChevronLeft className="size-3" /> swipe to change month <ChevronRight className="size-3" />
        </p>
      )}

      {/* Bottom sheet — mobile tap detail */}
      {selectedCell && (
        <DayDetailCard cell={selectedCell} onClose={() => setSelectedCell(null)} />
      )}
    </div>
  );
}
