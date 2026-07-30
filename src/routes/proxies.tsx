import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate, fmtTime, todayISO } from "@/lib/leave";

export const Route = createFileRoute("/proxies")({
  head: () => ({
    meta: [
      { title: "Proxy Duties — CSC Leave Management" },
      {
        name: "description",
        content: "Accept or decline proxy lectures assigned to you by your head of department.",
      },
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
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ProxiesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const { data: rows = [] } = useQuery({
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

      // Resolve absentee_id: prefer the new direct column, fall back to join, then direct query
      const rowsWithIds = await Promise.all(
        raw.map(async (r) => {
          // 1. Direct column (new — set on all rows going forward)
          let absenteeId: string | null = (r as any).absentee_teacher_id ?? null;
          // 2. Join result (works once the RLS policy from migration is applied)
          if (!absenteeId) absenteeId = (r.leave_requests as any)?.teacher_id ?? null;
          // 3. Direct query fallback
          if (!absenteeId && r.leave_request_id) {
            const { data: lr } = await supabase
              .from("leave_requests")
              .select("teacher_id")
              .eq("id", r.leave_request_id)
              .maybeSingle();
            absenteeId = lr?.teacher_id ?? null;
          }
          return { ...r, absentee_id: absenteeId };
        }),
      );

      const absenteeIds = rowsWithIds.map((r) => r.absentee_id).filter(Boolean) as string[];
      const people = absenteeIds.length ? await fetchPeople([...new Set(absenteeIds)]) : {};

      return rowsWithIds.map((r) => ({
        ...r,
        absentee: r.absentee_id ? people[r.absentee_id] : undefined,
      }));
    },
  });

  // My own lectures (for compensation offer)
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

  // My outgoing compensation offers
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
      const rows = data ?? [];
      const toIds = [...new Set(rows.map((r) => r.to_teacher_id))];
      const people = toIds.length ? await fetchPeople(toIds) : {};
      return rows.map((r) => ({ ...r, to_teacher: people[r.to_teacher_id] }));
    },
  });

  // Incoming compensation offers
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
      const rows = data ?? [];
      const fromIds = [...new Set(rows.map((r) => r.from_teacher_id))];
      const people = fromIds.length ? await fetchPeople(fromIds) : {};
      return rows.map((r) => ({ ...r, from_teacher: people[r.from_teacher_id] }));
    },
  });

  async function respond(id: string, status: "accepted" | "rejected") {
    const { error } = await supabase.from("proxy_assignments").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "accepted" ? "Proxy accepted" : "Proxy declined");
    qc.invalidateQueries();
  }

  async function respondToComp(id: string, status: "accepted" | "rejected", offer?: any) {
    const { error } = await supabase
      .from("compensation_assignments")
      .update({ status })
      .eq("id", id);
    if (error) return toast.error(error.message);

    if (status === "accepted" && offer) {
      const { data: srcLecture } = await supabase
        .from("lectures")
        .select("subject, class_name, start_time, end_time, room, department_id")
        .eq("id", offer.lecture_id)
        .maybeSingle();

      if (srcLecture) {
        const compDate = offer.compensation_date;
        const dow = new Date(compDate + "T00:00:00").getDay();
        await supabase.from("lectures").insert({
          teacher_id: profile!.id,
          department_id: srcLecture.department_id ?? profile!.department_id,
          day_of_week: dow,
          lecture_date: compDate,
          start_time: srcLecture.start_time,
          end_time: srcLecture.end_time,
          subject: srcLecture.subject,
          class_name: srcLecture.class_name,
          room: srcLecture.room,
        });
      }
    }

    toast.success(
      status === "accepted"
        ? "Compensation accepted — lecture added to your schedule"
        : "Compensation declined",
    );
    qc.invalidateQueries();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const accepted = rows.filter((r) => r.status === "accepted");
  const handled = rows.filter((r) => r.status !== "pending");

  return (
    <AppShell title="Proxy Duties" subtitle="Lectures your HOD has asked you to cover">
      <div className="space-y-6">
        {/* Pending proxy requests */}
        <SectionCard title="Awaiting your response">
          {pending.length === 0 ? (
            <Empty>No proxy requests waiting on you.</Empty>
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
                >
                  <div>
                    <p className="font-semibold">
                      {r.subject} · {r.class_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {fmtDate(r.proxy_date)} · {fmtTime(r.start_time)} – {fmtTime(r.end_time)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Covering for {r.absentee?.full_name ?? "a colleague"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => respond(r.id, "accepted")}>
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => respond(r.id, "rejected")}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Incoming compensation offers */}
        {incomingOffers.filter((o) => o.status === "pending").length > 0 && (
          <SectionCard
            title="Compensation offers for you"
            subtitle="A colleague who covered your leave is offering you one of their lectures"
          >
            <ul className="space-y-3">
              {incomingOffers
                .filter((o) => o.status === "pending")
                .map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/8 p-4"
                  >
                    <div>
                      <p className="font-semibold text-success-foreground">
                        🎁 Compensation from {o.from_teacher?.full_name ?? "a colleague"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        On {fmtDate(o.compensation_date)}
                      </p>
                      {o.note && (
                        <p className="text-xs text-muted-foreground mt-1">Note: {o.note}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => respondToComp(o.id, "accepted", o)}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respondToComp(o.id, "rejected", o)}
                      >
                        Decline
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}

        {/* Compensation offer form for accepted proxies */}
        {accepted.length > 0 && (
          <SectionCard
            title="Offer compensation"
            subtitle="You've covered someone's leave — offer one of your lectures as compensation"
          >
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
          </SectionCard>
        )}

        {/* History */}
        <SectionCard title="Proxy History">
          {handled.length === 0 ? (
            <Empty>Nothing here yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {handled.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <span>
                    {fmtDate(r.proxy_date)} · {fmtTime(r.start_time)} · {r.subject} ({r.class_name})
                    {r.absentee?.full_name ? ` · for ${r.absentee.full_name}` : ""}
                  </span>
                  <Badge variant={r.status === "accepted" ? "default" : "secondary"}>
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* My outgoing compensation offers */}
        {myCompOffers.length > 0 && (
          <SectionCard title="My Compensation Offers">
            <ul className="space-y-2">
              {myCompOffers.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <span>
                    To {o.to_teacher?.full_name ?? "colleague"} · {fmtDate(o.compensation_date)}
                    {o.note ? ` · "${o.note}"` : ""}
                  </span>
                  <Badge
                    variant={
                      o.status === "accepted"
                        ? "default"
                        : o.status === "rejected"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {o.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}

// ── Compensation Form ─────────────────────────────────────────────────────────
// Flow: Step 1 — confirm absentee teacher (auto-filled)
//       Step 2 — pick compensation date
//       Step 3 — pick a lecture from YOUR schedule on that day's day-of-week
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
  const [busy, setBusy] = useState(false);

  // Check for existing offer
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

  // When date changes, reset lecture selection and filter lectures for that day-of-week
  const selectedDow = useMemo(() => {
    if (!compDate) return null;
    return new Date(compDate + "T00:00:00").getDay();
  }, [compDate]);

  // Filter my lectures to only those on the selected day-of-week
  // fixed lectures match by day_of_week; dated lectures match by lecture_date == compDate
  const lecturesOnDay = useMemo(() => {
    if (selectedDow === null) return [];
    return myLectures.filter((l) => {
      if (l.lecture_date) {
        // dated one-off lecture — must match the exact date
        return l.lecture_date === compDate;
      }
      // regular recurring lecture — match by day of week
      return l.day_of_week === selectedDow;
    });
  }, [myLectures, selectedDow, compDate]);

  // Reset lecture selection when date changes
  function handleDateChange(val: string) {
    setCompDate(val);
    setLectureId("");
  }

  // Already sent and not rejected — show status only
  if (existingOffer && existingOffer.status !== "rejected") {
    return (
      <li className="rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">
          {proxyRow.subject} · {fmtDate(proxyRow.proxy_date)} — covering{" "}
          {proxyRow.absentee?.full_name ?? "colleague"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Compensation offer already sent · Status:{" "}
          <span className="font-medium capitalize">{existingOffer.status}</span>
        </p>
      </li>
    );
  }

  async function submit() {
    if (!proxyRow.absentee_id) {
      return toast.error(
        "Could not identify the absent teacher. Run the latest migration (20260730000000_proxy_absentee_fix.sql) and re-load.",
      );
    }
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
    <li className="rounded-lg border border-info/30 bg-info/8 p-4 space-y-4">
      {/* Header */}
      <div>
        <p className="font-semibold text-sm">
          {proxyRow.subject} · {fmtDate(proxyRow.proxy_date)}
        </p>
        <p className="text-xs text-muted-foreground">
          You covered <span className="font-medium">{absenteeName}</span>'s lecture — offer them
          one of yours as compensation
        </p>
      </div>

      {/* Step 1 — Teacher (auto-filled, read-only) */}
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step 1 · Teacher to compensate
        </Label>
        <div className="h-8 px-3 flex items-center rounded-md border border-border bg-muted text-sm text-foreground">
          {absenteeName}
        </div>
      </div>

      {/* Step 2 — Pick a date */}
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step 2 · Compensation date
        </Label>
        <Input
          type="date"
          min={today}
          value={compDate}
          onChange={(e) => handleDateChange(e.target.value)}
          className="h-8 text-xs"
        />
        {compDate && selectedDow !== null && (
          <p className="text-xs text-muted-foreground">
            Showing your <span className="font-medium">{DAY_NAMES[selectedDow]}</span> lectures
            below
          </p>
        )}
      </div>

      {/* Step 3 — Pick lecture on that day */}
      <div className="space-y-1">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step 3 · Your lecture on that day
        </Label>
        {!compDate ? (
          <p className="text-xs text-muted-foreground italic">Pick a date first to see available lectures</p>
        ) : lecturesOnDay.length === 0 ? (
          <p className="text-xs text-destructive">
            You have no lectures on {DAY_NAMES[selectedDow!]}s. Pick a different date.
          </p>
        ) : (
          <Select value={lectureId} onValueChange={setLectureId}>
            <SelectTrigger className="text-xs h-8">
              <SelectValue placeholder="Select a lecture…" />
            </SelectTrigger>
            <SelectContent>
              {lecturesOnDay.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {fmtTime(l.start_time)} – {fmtTime(l.end_time)} · {l.subject} ({l.class_name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Optional note */}
      <div className="space-y-1">
        <Label className="text-xs">Note (optional)</Label>
        <Input
          placeholder={`e.g. Taking your ${compDate ? DAY_NAMES[selectedDow!] : ""} lecture for you`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      <Button size="sm" onClick={submit} disabled={busy || !compDate || !lectureId}>
        {busy ? "Sending…" : "Send Compensation Offer"}
      </Button>
    </li>
  );
}
