import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { firePush } from "@/lib/push.functions";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { Empty, ListSkeleton } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { GuardedInput } from "@/components/GuardedField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate, fmtTime, todayISO } from "@/lib/leave";
import { BookOpen, CalendarClock, CheckCircle2, Clock3, Gift, Info, UserCheck, XCircle } from "lucide-react";

export const Route = createFileRoute("/proxies")({
  head: () => ({
    meta: [
      { title: "Proxy Duties — CSC Leave Management" },
      { name: "description", content: "Accept or decline proxy lectures assigned to you by your head of department." },
      { property: "og:title", content: "Proxy Duties — CSC Leave Management" },
      { property: "og:description", content: "Your assigned proxy lectures and their status." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <ProxiesPage />
    </Guarded>
  ),
});

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ProxiesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const { data: rows = [], isLoading: rowsLoading, isError: rowsError } = useQuery({
    queryKey: ["my-proxies", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("*, leave_requests(id, teacher_id)")
        .eq("proxy_teacher_id", profile!.id)
        .order("proxy_date");
      if (error) throw error;
      const raw = data ?? [];

      // Collect leave_request_ids that don't already have absentee info embedded,
      // then resolve them all in ONE query instead of one per row (#1 N+1 fix).
      const needsLookup = raw.filter(
        (r) => !(r as any).absentee_teacher_id && !(r.leave_requests as any)?.teacher_id && r.leave_request_id,
      );
      const leaveTeacherMap: Record<string, string> = {};
      if (needsLookup.length > 0) {
        const { data: lrRows } = await supabase
          .from("leave_requests")
          .select("id, teacher_id")
          .in("id", needsLookup.map((r) => r.leave_request_id!));
        for (const lr of lrRows ?? []) leaveTeacherMap[lr.id] = lr.teacher_id;
      }

      const rowsWithIds = raw.map((r) => {
        const absenteeId: string | null =
          (r as any).absentee_teacher_id ??
          (r.leave_requests as any)?.teacher_id ??
          (r.leave_request_id ? leaveTeacherMap[r.leave_request_id] : null) ??
          null;
        return { ...r, absentee_id: absenteeId };
      });

      const absenteeIds = rowsWithIds.map((r) => r.absentee_id).filter(Boolean) as string[];
      const people = absenteeIds.length ? await fetchPeople([...new Set(absenteeIds)]) : {};

      return rowsWithIds.map((r) => ({
        ...r,
        absentee: r.absentee_id ? people[r.absentee_id] : undefined,
      }));
    },
  });

  const { data: myLectures = [] } = useQuery({
    queryKey: ["my-lectures-for-comp", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("id, day_of_week, start_time, end_time, subject, class_name, lecture_date")
        .eq("teacher_id", profile!.id)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: myCompOffers = [] } = useQuery({
    queryKey: ["my-comp-offers", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compensation_assignments")
        .select("*")
        .eq("from_teacher_id", profile!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const offers = data ?? [];
      const toIds = [...new Set(offers.map((r) => r.to_teacher_id))];
      const people = toIds.length ? await fetchPeople(toIds) : {};
      return offers.map((r) => ({ ...r, to_teacher: people[r.to_teacher_id] }));
    },
  });

  const { data: incomingOffers = [] } = useQuery({
    queryKey: ["incoming-comp-offers", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compensation_assignments")
        .select("*")
        .eq("to_teacher_id", profile!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const offers = data ?? [];
      const fromIds = [...new Set(offers.map((r) => r.from_teacher_id))];
      const people = fromIds.length ? await fetchPeople(fromIds) : {};
      return offers.map((r) => ({ ...r, from_teacher: people[r.from_teacher_id] }));
    },
  });

  async function respond(id: string, status: "accepted" | "rejected") {
    const { error } = await supabase.from("proxy_assignments").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "accepted" ? "Proxy accepted" : "Proxy declined");

    // Notify HOD when a proxy is declined so they can reassign
    if (status === "rejected") {
      const row = rows.find((r) => r.id === id);
      const absenteeName = row?.absentee?.full_name ?? "a teacher";
      const subject = (row as any)?.subject ?? "a class";
      firePush({
        userIds: [`__hod_dept_${profile!.department_id}__`],
        title: "Proxy Declined",
        body: `${profile!.full_name} declined to cover ${subject} for ${absenteeName} — please reassign`,
        targetUrl: "/requests",
      });
    }

    qc.invalidateQueries();
  }

  async function respondToComp(id: string, status: "accepted" | "rejected", offer?: any) {
    const { error } = await supabase
      .from("compensation_assignments")
      .update({ status })
      .eq("id", id);
    if (error) return toast.error(error.message);

    if (status === "accepted" && offer) {
      // Fetch the source lecture the proxy teacher is gifting
      const { data: srcLecture } = await supabase
        .from("lectures")
        .select("id, subject, class_name, start_time, end_time, room, department_id, lecture_date, day_of_week")
        .eq("id", offer.lecture_id)
        .maybeSingle();

      if (srcLecture) {
        const compDate = offer.compensation_date;
        const dow = new Date(compDate + "T00:00:00").getDay();
        const dept = srcLecture.department_id ?? profile!.department_id;

        if (srcLecture.lecture_date) {
          // One-off dated lecture — reassign it directly to the leave-taker
          await supabase
            .from("lectures")
            .update({ teacher_id: offer.to_teacher_id })
            .eq("id", srcLecture.id);
        } else {
          // Recurring fixed lecture:
          // 1. Give the leave-taker a dated copy of this lecture on compDate
          await supabase.from("lectures").insert({
            teacher_id: offer.to_teacher_id,
            department_id: dept,
            day_of_week: dow,
            lecture_date: compDate,
            start_time: srcLecture.start_time,
            end_time: srcLecture.end_time,
            subject: srcLecture.subject,
            class_name: srcLecture.class_name,
            room: srcLecture.room,
          });

          // 2. Insert a dated tombstone for the proxy teacher on compDate so their
          //    fixed lecture is suppressed in schedule/reports on that specific day.
          //    The subject prefix __COMP_GIVEN__ is filtered out in computeTeacherRow.
          await supabase.from("lectures").insert({
            teacher_id: offer.from_teacher_id,
            department_id: dept,
            day_of_week: dow,
            lecture_date: compDate,
            start_time: srcLecture.start_time,
            end_time: srcLecture.end_time,
            subject: `__COMP_GIVEN__${srcLecture.subject}`,
            class_name: srcLecture.class_name,
            room: srcLecture.room,
          });
        }
      }
    }

    toast.success(
      status === "accepted"
        ? "Compensation accepted — lecture moved to your schedule"
        : "Compensation declined",
    );
    qc.invalidateQueries();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const accepted = rows.filter((r) => r.status === "accepted");
  const handled = rows.filter((r) => r.status !== "pending");
  const pendingIncoming = incomingOffers.filter((o) => o.status === "pending");

  // Stats
  const totalAccepted = rows.filter((r) => r.status === "accepted").length;
  const totalDeclined = rows.filter((r) => r.status === "rejected").length;
  const totalPending = pending.length;

  if (rowsLoading) {
    return (
      <AppShell title="Proxy Duties" subtitle="Lectures your HOD has assigned you to cover">
        <ListSkeleton rows={4} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Proxy Duties" subtitle="Lectures your HOD has assigned you to cover">
      <div className="space-y-6">

        {/* Summary stats strip */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { label: "Awaiting response", value: totalPending, icon: Clock3, color: "text-warning-foreground", bg: "bg-warning/10 border-warning/25" },
            { label: "Accepted this year", value: totalAccepted, icon: CheckCircle2, color: "text-success", bg: "bg-success/8 border-success/20" },
            { label: "Declined", value: totalDeclined, icon: XCircle, color: "text-muted-foreground", bg: "bg-muted/60 border-border" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`rounded-xl border p-3 sm:p-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3 ${bg}`}>
              <Icon className={`size-4 shrink-0 sm:size-5 ${color}`} />
              <div>
                <p className={`text-xl font-bold sm:text-2xl ${color}`}>{value}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Pending proxy requests */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="size-4 text-warning-foreground" />
            <h2 className="font-semibold text-sm">Awaiting your response</h2>
            {totalPending > 0 && (
              <span className="ml-1 rounded-full bg-warning/20 text-warning-foreground text-xs font-bold px-2 py-0.5">{totalPending}</span>
            )}
          </div>
          {pending.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 py-10 text-center">
              <CalendarClock className="mx-auto size-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No proxy requests waiting on you.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li key={r.id} className="group rounded-xl border border-warning/30 bg-warning/5 overflow-hidden transition-all hover:border-warning/50 hover:bg-warning/8">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15">
                        <BookOpen className="size-4 text-warning-foreground" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{r.subject} <span className="text-muted-foreground font-normal">· {r.class_name}</span></p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmtDate(r.proxy_date)} · {fmtTime(r.start_time)} – {fmtTime(r.end_time)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Covering for <span className="font-medium text-foreground">{r.absentee?.full_name ?? "a colleague"}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1.5" onClick={() => respond(r.id, "accepted")}>
                        <CheckCircle2 className="size-3.5" /> Accept
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => respond(r.id, "rejected")}>
                        <XCircle className="size-3.5" /> Decline
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Incoming compensation offers */}
        {pendingIncoming.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <Gift className="size-4 text-success" />
              <h2 className="font-semibold text-sm">Compensation offers for you</h2>
              <span className="ml-1 rounded-full bg-success/15 text-success text-xs font-bold px-2 py-0.5">{pendingIncoming.length}</span>
            </div>
            <ul className="space-y-3">
              {pendingIncoming.map((o) => (
                <li key={o.id} className="rounded-xl border border-success/25 bg-success/6 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/15">
                        <Gift className="size-4 text-success" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-success-foreground">
                          From {o.from_teacher?.full_name ?? "a colleague"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">Compensation on {fmtDate(o.compensation_date)}</p>
                        {o.note && <p className="text-xs text-muted-foreground mt-0.5 italic">"{o.note}"</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1.5 bg-success hover:bg-success/90 text-success-foreground" onClick={() => respondToComp(o.id, "accepted", o)}>
                        <CheckCircle2 className="size-3.5" /> Accept
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => respondToComp(o.id, "rejected", o)}>
                        <XCircle className="size-3.5" /> Decline
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Compensation offer form for accepted proxies */}
        {accepted.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <UserCheck className="size-4 text-info" />
              <h2 className="font-semibold text-sm">Offer compensation</h2>
            </div>
            <p className="text-xs text-muted-foreground -mt-1 mb-3">You've covered someone's leave — offer one of your lectures as compensation.</p>
            <ul className="space-y-4">
              {accepted.map((r) => (
                <CompensationForm
                  key={r.id}
                  proxyRow={r}
                  myLectures={myLectures}
                  today={today}
                  onDone={() => qc.invalidateQueries()}
                />
              ))}
            </ul>
          </div>
        )}

        {/* History */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="size-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Proxy history</h2>
          </div>
          {handled.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 py-8 text-center">
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Subject · Class</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Time</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Covering</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {handled.map((r, i) => (
                    <tr key={r.id} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-4 py-3 font-medium">{fmtDate(r.proxy_date)}</td>
                      <td className="px-4 py-3">{r.subject} <span className="text-muted-foreground">· {r.class_name}</span></td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtTime(r.start_time)} – {fmtTime(r.end_time)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.absentee?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge
                          variant={r.status === "accepted" ? "default" : "secondary"}
                          className={r.status === "accepted" ? "bg-success/15 text-success border-success/25" : ""}
                        >
                          {r.status === "accepted" ? "Accepted" : "Declined"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* My outgoing compensation offers */}
        {myCompOffers.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <Gift className="size-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">My compensation offers</h2>
            </div>
            <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-semibold">To</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Note</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myCompOffers.map((o, i) => (
                    <tr key={o.id} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-4 py-3 font-medium">{o.to_teacher?.full_name ?? "colleague"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(o.compensation_date)}</td>
                      <td className="px-4 py-3 text-muted-foreground italic">{o.note ? `"${o.note}"` : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge
                          variant={o.status === "accepted" ? "default" : o.status === "rejected" ? "destructive" : "secondary"}
                          className={o.status === "accepted" ? "bg-success/15 text-success border-success/25" : ""}
                        >
                          {o.status === "accepted" ? "Accepted" : o.status === "rejected" ? "Declined" : "Pending"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Compensation Form ─────────────────────────────────────────────────────────
function CompensationForm({
  proxyRow,
  myLectures,
  today,
  onDone,
}: {
  proxyRow: any;
  myLectures: any[];
  today: string;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const [compDate, setCompDate] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: existingOffer } = useQuery({
    queryKey: ["comp-offer-check", proxyRow.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("compensation_assignments")
        .select("id, status")
        .eq("proxy_assignment_id", proxyRow.id)
        .eq("from_teacher_id", profile!.id)
        .maybeSingle();
      return data;
    },
  });

  const selectedDow = useMemo(() => {
    if (!compDate) return null;
    return new Date(compDate + "T00:00:00").getDay();
  }, [compDate]);

  const lecturesOnDay = useMemo(() => {
    if (selectedDow === null) return [];
    return myLectures.filter((l) => {
      if (l.lecture_date) return l.lecture_date === compDate;
      return l.day_of_week === selectedDow;
    });
  }, [myLectures, selectedDow, compDate]);

  function handleDateChange(val: string) {
    setCompDate(val);
    setLectureId("");
  }

  if (existingOffer && existingOffer.status !== "rejected") {
    return (
      <li className="rounded-xl border border-border bg-muted/30 p-4 text-sm list-none">
        <p className="font-medium">{proxyRow.subject} · {fmtDate(proxyRow.proxy_date)} — covering {proxyRow.absentee?.full_name ?? "colleague"}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Compensation offer sent · Status: <span className="font-medium capitalize">{existingOffer.status}</span>
        </p>
      </li>
    );
  }

  async function submit() {
    if (!proxyRow.absentee_id) return toast.error("Could not identify the absent teacher.");
    if (!compDate) return toast.error("Pick a compensation date");
    if (compDate < today) return toast.error("Date must be today or later");
    if (!lectureId) return toast.error("Select a lecture to offer");

    setBusy(true);
    const { error } = await supabase.from("compensation_assignments").insert({
      proxy_assignment_id: proxyRow.id,
      from_teacher_id: profile!.id,
      to_teacher_id: proxyRow.absentee_id,
      lecture_id: lectureId,
      compensation_date: compDate,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Compensation offer sent to ${proxyRow.absentee?.full_name ?? "colleague"}!`);
    onDone();
  }

  const absenteeName = proxyRow.absentee?.full_name ?? "colleague";

  return (
    <li className="rounded-xl border border-info/25 bg-info/5 p-4 list-none">
      <div className="mb-4">
        <p className="font-semibold text-sm">{proxyRow.subject} · {fmtDate(proxyRow.proxy_date)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          You covered <span className="font-medium text-foreground">{absenteeName}</span>'s lecture
        </p>
        <p className="text-xs text-info mt-1">
          <Info className="size-4 inline mr-1"/>The lecture you select below will be <strong>moved</strong> to {absenteeName}'s schedule on the chosen date — it will no longer appear in yours.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compensate</Label>
          <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted text-sm">{absenteeName}</div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</Label>
          <Input type="date" min={today} value={compDate} onChange={(e) => handleDateChange(e.target.value)} className="h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your lecture {compDate && selectedDow !== null ? `(${DAY_NAMES[selectedDow]}s)` : ""}
          </Label>
          {!compDate ? (
            <div className="h-9 px-3 flex items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">Pick a date first</div>
          ) : lecturesOnDay.length === 0 ? (
            <div className="h-9 px-3 flex items-center rounded-md border border-destructive/30 text-xs text-destructive">No lectures on this day</div>
          ) : (
            <Select value={lectureId} onValueChange={setLectureId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select lecture…" /></SelectTrigger>
              <SelectContent>
                {lecturesOnDay.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {fmtTime(l.start_time)} · {l.subject} ({l.class_name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Note (optional)</Label>
          <GuardedInput placeholder="Add a message…" value={note} onChange={setNote} onGuardError={setNoteError} fieldName="Message" className="h-9 text-sm" />
        </div>
        <Button size="sm" onClick={submit} disabled={busy || !compDate || !lectureId} className="gap-1.5">
          <Gift className="size-3.5" />
          {busy ? "Sending…" : "Send offer"}
        </Button>
      </div>
    </li>
  );
}