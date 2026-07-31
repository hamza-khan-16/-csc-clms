import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, LayoutGrid, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DAYS, fmtDate, fmtTime, todayISO } from "@/lib/leave";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "My Schedule — CSC Leave Management" },
      {
        name: "description",
        content:
          "Fixed weekly timetable plus one-off added lectures, used to assign proxy teachers during leave.",
      },
      { property: "og:title", content: "My Schedule — CSC Leave Management" },
      { property: "og:description", content: "Fixed weekly timetable and dated extra lectures." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <SchedulePage />
    </Guarded>
  ),
});

type Lecture = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject: string;
  class_name: string;
  room: string | null;
  lecture_date: string | null;
  is_proxy?: boolean;
  proxy_status?: string;
  covering_for?: string | null;
};

// Mon=1 … Sat=6, skip Sunday (0)
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

function todayDow() {
  const d = new Date().getDay(); // 0=Sun
  return d === 0 ? 1 : d; // default to Monday if today is Sunday
}

// Subject → colour mapping (cycles through a palette)
const SUBJECT_COLORS = [
  { bg: "bg-blue-600", text: "text-white" },
  { bg: "bg-teal-600", text: "text-white" },
  { bg: "bg-orange-500", text: "text-white" },
  { bg: "bg-purple-600", text: "text-white" },
  { bg: "bg-amber-700", text: "text-white" },
  { bg: "bg-green-600", text: "text-white" },
  { bg: "bg-rose-600", text: "text-white" },
  { bg: "bg-cyan-600", text: "text-white" },
];

function TimetableModal({
  lectures,
  teacherName,
  onClose,
}: {
  lectures: Lecture[];
  teacherName: string;
  onClose: () => void;
}) {
  const fixed = lectures.filter((l) => !l.lecture_date);

  // Collect unique time slots sorted chronologically
  const timeSlots = Array.from(new Set(fixed.map((l) => `${l.start_time}|${l.end_time}`)))
    .sort()
    .map((s) => { const [start, end] = s.split("|"); return { start, end }; });

  // Map subject → colour
  const subjects = Array.from(new Set(fixed.map((l) => l.subject)));
  const subjectColor: Record<string, (typeof SUBJECT_COLORS)[number]> = {};
  subjects.forEach((s, i) => { subjectColor[s] = SUBJECT_COLORS[i % SUBJECT_COLORS.length]; });

  function fmt(t: string) {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  // On mobile we show a day-per-tab view; on md+ we show the full grid
  const DAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES_FULL  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WEEKDAYS_LIST = [1, 2, 3, 4, 5, 6];
  const [mobileDay, setMobileDay] = useState(1);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full sm:max-w-5xl rounded-t-2xl sm:rounded-2xl bg-[#111] text-white shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between bg-[#0a0a0a] px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold">Weekly Timetable</h2>
            <p className="text-xs sm:text-sm text-white/50">{teacherName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10 transition-colors">
            <X className="size-5" />
          </button>
        </div>

        {/* Mobile: day tab strip */}
        <div className="flex gap-1 px-3 pt-3 pb-1 overflow-x-auto md:hidden shrink-0">
          {WEEKDAYS_LIST.map((dow, i) => (
            <button
              key={dow}
              type="button"
              onClick={() => setMobileDay(dow)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                mobileDay === dow
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white hover:bg-white/10",
              )}
            >
              {DAY_NAMES_SHORT[i]}
            </button>
          ))}
        </div>

        {/* Mobile: stacked card view */}
        <div className="md:hidden overflow-y-auto p-3 space-y-2 flex-1">
          {timeSlots.length === 0 ? (
            <p className="py-8 text-center text-white/40 text-sm">No fixed lectures yet.</p>
          ) : (
            timeSlots.map((slot) => {
              const cell = fixed.find(
                (l) => l.day_of_week === mobileDay && l.start_time === slot.start && l.end_time === slot.end,
              );
              if (!cell) return null;
              const col = subjectColor[cell.subject];
              return (
                <div key={`${slot.start}-${slot.end}`} className={cn("rounded-xl p-3", col.bg)}>
                  <p className={cn("font-bold text-sm", col.text)}>{cell.subject}</p>
                  <p className={cn("text-xs mt-0.5 opacity-80", col.text)}>
                    {cell.class_name}{cell.room ? ` · ${cell.room}` : ""} · {fmt(slot.start)}–{fmt(slot.end)}
                  </p>
                </div>
              );
            }).filter(Boolean)
          )}
          {timeSlots.length > 0 &&
            !timeSlots.some((slot) =>
              fixed.find((l) => l.day_of_week === mobileDay && l.start_time === slot.start),
            ) && (
              <p className="py-6 text-center text-white/40 text-sm">
                No lectures on {DAY_NAMES_FULL[mobileDay - 1]}.
              </p>
            )}
        </div>

        {/* Desktop: full grid */}
        <div className="hidden md:block overflow-auto flex-1 p-4">
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="w-28 pb-2 text-left text-xs text-white/40 font-normal" />
                {DAY_NAMES_SHORT.map((d) => (
                  <th key={d} className="pb-2 text-center text-xs font-semibold text-white/70 min-w-[90px]">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-white/40 text-sm">
                    No fixed lectures in your timetable yet.
                  </td>
                </tr>
              ) : (
                timeSlots.map((slot) => (
                  <tr key={`${slot.start}-${slot.end}`}>
                    <td className="pr-3 text-right text-xs text-white/40 font-mono whitespace-nowrap align-middle">
                      {fmt(slot.start)}–{fmt(slot.end)}
                    </td>
                    {WEEKDAYS_LIST.map((dow) => {
                      const cell = fixed.find(
                        (l) => l.day_of_week === dow && l.start_time === slot.start && l.end_time === slot.end,
                      );
                      if (!cell) return <td key={dow} className="rounded-md bg-white/5 min-w-[90px] h-14" />;
                      const col = subjectColor[cell.subject];
                      return (
                        <td key={dow} className={cn("rounded-md px-2 py-1.5 min-w-[90px] h-14 align-top", col.bg)}>
                          <p className={cn("font-bold text-xs leading-tight", col.text)}>{cell.subject}</p>
                          <p className={cn("text-[10px] opacity-80 mt-0.5", col.text)}>
                            {cell.class_name}{cell.room ? ` · ${cell.room}` : ""}
                          </p>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        {subjects.length > 0 && (
          <div className="flex flex-wrap gap-3 px-4 sm:px-6 py-3 border-t border-white/10 shrink-0">
            {subjects.map((s) => {
              const col = subjectColor[s];
              return (
                <span key={s} className="flex items-center gap-1.5 text-xs text-white/60">
                  <span className={cn("inline-block size-3 rounded-sm", col.bg)} />
                  {s}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SchedulePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();
  const [showTimetable, setShowTimetable] = useState(false);

  // Selected weekday tab (1=Mon … 6=Sat)
  const [selectedDay, setSelectedDay] = useState<number>(todayDow());

  const [mode, setMode] = useState<"fixed" | "added">("fixed");
  const [form, setForm] = useState({
    day: String(todayDow()),
    date: today,
    start: "09:00",
    end: "10:00",
    subject: "",
    className: "",
    room: "",
  });

  // ── Fetch own lectures ──────────────────────────────────────────────────────
  const { data: lectures = [] } = useQuery({
    queryKey: ["my-lectures", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("id, day_of_week, start_time, end_time, subject, class_name, room, lecture_date")
        .eq("teacher_id", profile!.id)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as Lecture[];
    },
  });

  // ── Fetch accepted proxy duties ─────────────────────────────────────────────
  const { data: proxies = [] } = useQuery({
    queryKey: ["my-accepted-proxies", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("id, proxy_date, start_time, end_time, subject, class_name, leave_request_id, status")
        .eq("proxy_teacher_id", profile!.id)
        .in("status", ["pending", "accepted"])
        .gte("proxy_date", today)
        .order("proxy_date")
        .order("start_time");
      if (error) throw error;

      // Fetch absentee names
      const reqIds = (data ?? []).map((p) => p.leave_request_id).filter((id): id is string => id !== null);
      let nameMap: Record<string, string> = {};
      if (reqIds.length) {
        const { data: reqs } = await supabase
          .from("leave_requests")
          .select("id, teacher_id")
          .in("id", reqIds);
        const teacherIds = [...new Set((reqs ?? []).map((r) => r.teacher_id))];
        if (teacherIds.length) {
          const { data: people } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", teacherIds);
          const personMap = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
          nameMap = Object.fromEntries(
            (reqs ?? []).map((r) => [r.id, personMap[r.teacher_id] ?? "a colleague"]),
          );
        }
      }

      return (data ?? []).map((p) => ({
        id: p.id,
        day_of_week: new Date(p.proxy_date + "T00:00:00").getDay(),
        start_time: p.start_time,
        end_time: p.end_time,
        subject: p.subject,
        class_name: p.class_name,
        room: null as string | null,
        lecture_date: p.proxy_date,
        is_proxy: true,
        proxy_status: p.status as string,
        covering_for: p.leave_request_id ? (nameMap[p.leave_request_id] ?? null) : null,
      })) as Lecture[];
    },
  });

  // ── Fetch pending compensation offers (so absent teacher sees notification) ──
  const { data: pendingCompOffers = [] } = useQuery({
    queryKey: ["pending-comp-offers", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compensation_assignments")
        .select("id, from_teacher_id, compensation_date, lecture_id, note, status")
        .eq("to_teacher_id", profile!.id)
        .eq("status", "pending")
        .order("compensation_date");
      if (error) throw error;
      const rows = data ?? [];
      const fromIds = [...new Set(rows.map((r) => r.from_teacher_id))];
      const { data: people } = fromIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", fromIds)
        : { data: [] };
      const personMap = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      // Fetch lecture details for each offer
      const lecIds = [...new Set(rows.map((r) => r.lecture_id))];
      const { data: lectures } = lecIds.length
        ? await supabase.from("lectures").select("id, subject, class_name, start_time, end_time").in("id", lecIds)
        : { data: [] };
      const lecMap = Object.fromEntries((lectures ?? []).map((l) => [l.id, l]));
      return rows.map((r) => ({
        ...r,
        from_name: personMap[r.from_teacher_id] ?? "A colleague",
        lecture: lecMap[r.lecture_id] ?? null,
      }));
    },
  });

  // ── Cleanup stale dated lectures (past dates) ───────────────────────────────
  useEffect(() => {
    if (!profile) return;
    supabase
      .from("lectures")
      .delete()
      .eq("teacher_id", profile.id)
      .not("lecture_date", "is", null)
      .lt("lecture_date", today)
      .then(({ error }) => {
        if (!error) qc.invalidateQueries({ queryKey: ["my-lectures"] });
      });
  }, [profile, qc, today]);

  // ── Derive what to show for selectedDay ────────────────────────────────────
  // Fixed lectures: always show for the selected weekday
  const fixedForDay = useMemo(
    () => lectures.filter((l) => !l.lecture_date && l.day_of_week === selectedDay),
    [lectures, selectedDay],
  );

  // Dated lectures for the selected weekday: only those whose date falls on that weekday
  // AND that date is today or in the future
  const datedForDay = useMemo(
    () =>
      lectures.filter(
        (l) =>
          l.lecture_date &&
          l.lecture_date >= today &&
          l.day_of_week === selectedDay,
      ),
    [lectures, selectedDay, today],
  );

  // Accepted proxies for the selected weekday
  const proxiesForDay = useMemo(
    () => proxies.filter((p) => p.day_of_week === selectedDay),
    [proxies, selectedDay],
  );

  const allForDay = useMemo(
    () =>
      [...fixedForDay, ...datedForDay, ...proxiesForDay].sort((a, b) =>
        a.start_time.localeCompare(b.start_time),
      ),
    [fixedForDay, datedForDay, proxiesForDay],
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  async function addLecture(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim() || !form.className.trim())
      return toast.error("Subject and class are required");
    if (form.end <= form.start) return toast.error("End time must be after start time");
    if (mode === "added" && form.date < today)
      return toast.error("Pick today or a future date");

    const dow =
      mode === "added" ? new Date(form.date + "T00:00:00").getDay() : Number(form.day);

    const { error } = await supabase.from("lectures").insert({
      teacher_id: profile!.id,
      department_id: profile!.department_id,
      day_of_week: dow,
      lecture_date: mode === "added" ? form.date : null,
      start_time: form.start,
      end_time: form.end,
      subject: form.subject.trim(),
      class_name: form.className.trim(),
      room: form.room.trim(),
    });
    if (error) return toast.error(error.message);
    setForm({ ...form, subject: "", className: "", room: "" });
    // After adding, jump to the selected day so user sees their new entry
    if (mode === "added") {
      setSelectedDay(dow === 0 ? 1 : dow);
    } else {
      setSelectedDay(Number(form.day));
    }
    toast.success(mode === "added" ? "Added schedule created" : "Lecture added to fixed timetable");
    qc.invalidateQueries({ queryKey: ["my-lectures"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("lectures").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["my-lectures"] });
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const todayDowValue = new Date().getDay();

  return (
    <AppShell title="My Schedule" subtitle="Fixed timetable, added lectures and accepted proxy duties">
      {showTimetable && (
        <TimetableModal
          lectures={lectures}
          teacherName={profile?.full_name ?? ""}
          onClose={() => setShowTimetable(false)}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Pending compensation offers banner */}
          {pendingCompOffers.length > 0 && (
            <div className="rounded-lg border border-success/40 bg-success/8 p-4 space-y-2">
              <p className="text-sm font-semibold text-success-foreground">🎁 Compensation lecture offers pending your response</p>
              <p className="text-xs text-muted-foreground">Go to <strong>Proxy Duties</strong> to accept or decline. Accepted lectures will appear in your schedule automatically.</p>
              <ul className="mt-2 space-y-1">
                {pendingCompOffers.map((o) => (
                  <li key={o.id} className="text-xs text-muted-foreground">
                    · {o.from_name} is offering you a {o.lecture?.subject ?? "lecture"} ({o.lecture?.class_name}) on {fmtDate(o.compensation_date)}
                    {o.note ? ` — "${o.note}"` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Day-of-week tab strip */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((dow) => {
              const isToday = dow === todayDowValue;
              const isSelected = dow === selectedDay;
              return (
                <button
                  key={dow}
                  type="button"
                  onClick={() => setSelectedDay(dow)}
                  className={cn(
                    "relative rounded-xl px-4 py-2 text-sm font-semibold transition-all",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {DAYS[dow].slice(0, 3)}
                  {isToday && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-success" />
                  )}
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => setShowTimetable(true)}
          >
            <LayoutGrid className="size-4" />
            View Timetable
          </Button>
          </div>

          {/* Day schedule card */}
          <SectionCard
            title={DAYS[selectedDay]}
            subtitle={
              selectedDay === todayDowValue
                ? "Today's schedule"
                : `Your ${DAYS[selectedDay]} schedule`
            }
          >
            {allForDay.length === 0 ? (
              <Empty>No lectures scheduled for {DAYS[selectedDay]}.</Empty>
            ) : (
              <ul className="space-y-2">
                {allForDay.map((l) => (
                  <LectureRow key={l.id} lecture={l} onRemove={l.is_proxy ? undefined : remove} />
                ))}
              </ul>
            )}
          </SectionCard>

          {/* Upcoming dated lectures summary (all days) */}
          {(() => {
            const upcoming = lectures
              .filter((l) => l.lecture_date && l.lecture_date >= today)
              .sort((a, b) =>
                (a.lecture_date! + a.start_time).localeCompare(b.lecture_date! + b.start_time),
              );
            const upcomingProxies = proxies
              .slice()
              .sort((a, b) =>
                (a.lecture_date! + a.start_time).localeCompare(b.lecture_date! + b.start_time),
              );
            const all = [...upcoming, ...upcomingProxies].sort((a, b) =>
              (a.lecture_date! + a.start_time).localeCompare(b.lecture_date! + b.start_time),
            );
            if (all.length === 0) return null;
            return (
              <SectionCard
                title="Upcoming one-off lectures"
                subtitle="Added lectures and proxy duties — removed automatically once the date passes"
              >
                <ul className="space-y-2">
                  {all.map((l) => (
                    <LectureRow key={l.id} lecture={l} onRemove={l.is_proxy ? undefined : remove} showDate />
                  ))}
                </ul>
              </SectionCard>
            );
          })()}
        </div>

        {/* Add lecture sidebar */}
        <SectionCard title="Add Lecture">
          <form onSubmit={addLecture} className="space-y-3">
            <div className="space-y-2">
              <Label>Schedule type</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "fixed" | "added")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed — every week</SelectItem>
                  <SelectItem value="added">Added — a single date</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "fixed" ? (
              <div className="space-y-2">
                <Label>Day</Label>
                <Select value={form.day} onValueChange={(v) => setForm({ ...form, day: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {DAYS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="ldate">Date</Label>
                <Input
                  id="ldate"
                  type="date"
                  min={today}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start">Start</Label>
                <Input
                  id="start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">End</Label>
                <Input
                  id="end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="DSA"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="class">Class</Label>
              <Input
                id="class"
                placeholder="TY CS"
                value={form.className}
                onChange={(e) => setForm({ ...form, className: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room">Room</Label>
              <Input
                id="room"
                placeholder="301"
                value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full">
              {mode === "added" ? "Add to schedule" : "Add to fixed timetable"}
            </Button>
          </form>
        </SectionCard>
      </div>
    </AppShell>
  );
}

function LectureRow({
  lecture: l,
  onRemove,
  showDate = false,
}: {
  lecture: Lecture;
  onRemove?: (id: string) => void;
  showDate?: boolean;
}) {
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold truncate">{l.subject}</span>
            <span className="text-muted-foreground text-xs">{l.class_name}</span>
            {l.room && <span className="text-muted-foreground text-xs">· {l.room}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtTime(l.start_time)} – {fmtTime(l.end_time)}
            {showDate && l.lecture_date ? ` · ${fmtDate(l.lecture_date)}` : ""}
          </p>
          <div className="mt-1.5">
            {l.is_proxy ? (
              <Badge
                variant="secondary"
                className={
                  l.proxy_status === "accepted"
                    ? "border border-warning/30 bg-warning/12 text-warning-foreground text-[10px]"
                    : "border border-muted-foreground/30 bg-muted text-muted-foreground text-[10px]"
                }
              >
                {l.proxy_status === "accepted" ? "Proxy" : "Proxy (pending)"} · covering {l.covering_for ?? "colleague"}
              </Badge>
            ) : l.lecture_date ? (
              <Badge variant="outline" className="border-info/30 bg-info/12 text-info text-[10px]">
                Added lecture
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">
                Every week
              </Badge>
            )}
          </div>
        </div>
        {onRemove && (
          <Button variant="ghost" size="icon" className="shrink-0 -mt-1" onClick={() => onRemove(l.id)}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}
