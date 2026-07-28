import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
  covering_for?: string | null;
};

// Mon=1 … Sat=6, skip Sunday (0)
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

function todayDow() {
  const d = new Date().getDay(); // 0=Sun
  return d === 0 ? 1 : d; // default to Monday if today is Sunday
}

function SchedulePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

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
        .select("id, proxy_date, start_time, end_time, subject, class_name, leave_request_id")
        .eq("proxy_teacher_id", profile!.id)
        .eq("status", "accepted")
        .gte("proxy_date", today)
        .order("proxy_date")
        .order("start_time");
      if (error) throw error;

      // Fetch absentee names
      const reqIds = (data ?? []).map((p) => p.leave_request_id);
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
        covering_for: nameMap[p.leave_request_id] ?? null,
      })) as Lecture[];
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
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Day-of-week tab strip */}
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
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">
        {fmtTime(l.start_time)} – {fmtTime(l.end_time)}
      </span>
      <span className="flex-1 font-semibold">{l.subject}</span>
      <span className="text-muted-foreground">{l.class_name}</span>
      {l.room && <span className="text-muted-foreground">{l.room}</span>}

      {l.is_proxy ? (
        <Badge variant="secondary" className="border border-warning/30 bg-warning/12 text-warning-foreground">
          Proxy · covering {l.covering_for ?? "colleague"}
          {showDate && l.lecture_date ? ` · ${fmtDate(l.lecture_date)}` : ""}
        </Badge>
      ) : l.lecture_date ? (
        <Badge variant="outline" className="border-info/30 bg-info/12 text-info">
          Added{showDate ? ` · ${fmtDate(l.lecture_date)}` : ""}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Every week
        </Badge>
      )}

      {onRemove && (
        <Button variant="ghost" size="icon" onClick={() => onRemove(l.id)}>
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  );
}
