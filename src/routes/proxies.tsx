import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchPeople } from "@/lib/people";
import { firePush } from "@/lib/push.functions";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { Empty, ListSkeleton, Pagination } from "@/components/ui-bits";
import { haptic } from "@/lib/haptics";
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
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/proxies")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
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
  const t = useT();
    const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();

  const { data: rows = [], isLoading: rowsLoading, isError: rowsError } = useQuery({
    queryKey: ["my-proxies", profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("*, leave_requests(id, teacher_id)")
        .eq("proxy_teacher_id", profile!.id)
        .not("status", "eq", "cancelled")  // exclude cancelled (principal rejected the leave)
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
    staleTime: 30_000,
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
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compensation_assignments")
        .select("id, from_teacher_id, to_teacher_id, compensation_date, note, status, lecture_id, created_at")
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
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compensation_assignments")
        .select("id, from_teacher_id, to_teacher_id, compensation_date, note, status, lecture_id, created_at")
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
    // Optimistic update — immediately reflect the change in the UI
    qc.setQueryData(["my-proxies", profile?.id], (old: any[] | undefined) =>
      old ? old.map((r) => r.id === id ? { ...r, status } : r) : old
    );

    const { error } = await supabase.from("proxy_assignments").update({ status }).eq("id", id);
    if (error) {
      // Rollback on failure
      qc.invalidateQueries({ queryKey: ["my-proxies", profile?.id] });
      return toast.error(error.message);
    }
    haptic(status === "accepted" ? "success" : "warning");
    toast.success(status === "accepted" ? "Proxy accepted" : "Proxy declined");

    if (status === "rejected") {
      const row = rows.find((r) => r.id === id);
      const absenteeName = row?.absentee?.full_name ?? "a teacher";
      const subject = (row as any)?.subject ?? "a class";
      const className = (row as any)?.class_name ?? "";
      const proxyDate = (row as any)?.proxy_date ?? "";
      const startTime = (row as any)?.start_time ?? "";
      const dateStr = proxyDate
        ? new Date(proxyDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
        : "";
      const timeStr = startTime ? startTime.slice(0, 5) : "";

      // If the leave date has already passed, the HOD can't reassign — no point notifying for reassignment.
      // The cron job handles pending-expired proxies, but if the teacher actively rejects *after* the date,
      // we handle it here immediately: no push for reassignment, just inform HOD it's an empty class.
      const today = new Date().toISOString().slice(0, 10);
      const isPastDate = proxyDate && proxyDate < today;

      if (isPastDate) {
        // Past date rejection → notify HOD it became an empty class automatically
        firePush({
          userIds: [`__hod_dept_${profile!.department_id}__`],
          title: "Empty Class — Proxy Declined After Date",
          body: `${profile!.full_name} declined to cover ${subject}${className ? ` (${className})` : ""}${dateStr ? ` on ${dateStr}` : ""}${timeStr ? ` at ${timeStr}` : ""} for ${absenteeName}. The class is marked as empty (date has passed).`,
          targetUrl: "/requests",
        });
      } else {
        // Future/same-day rejection → notify HOD for reassignment as before
        firePush({
          userIds: [`__hod_dept_${profile!.department_id}__`],
          title: "Proxy Rejected — Reassignment Needed",
          body: `${profile!.full_name} declined to cover ${subject}${className ? ` (${className})` : ""}${dateStr ? ` on ${dateStr}` : ""}${timeStr ? ` at ${timeStr}` : ""} for ${absenteeName}. Please reassign.`,
          targetUrl: "/requests",
        });
      }
    }

    qc.invalidateQueries();
  }

  async function respondToComp(id: string, status: "accepted" | "rejected", offer?: any) {
    // When teacher accepts, go to hod_pending — HOD must approve before lecture is applied
    const newStatus = status === "accepted" ? "hod_pending" : "rejected";
    const { error } = await supabase
      .from("compensation_assignments")
      .update({ status: newStatus })
      .eq("id", id);
    if (error) return toast.error(error.message);

    if (status === "accepted" && offer) {
      // Notify HOD of the department
      firePush({
        userIds: [`__hod_dept_${profile!.department_id}__`],
        title: "Compensation Lecture — Approval Needed",
        body: `${profile!.full_name} accepted a compensation lecture from ${offer.from_teacher?.full_name ?? "a colleague"} on ${fmtDate(offer.compensation_date)}. Please approve or reject.`,
        targetUrl: "/requests",
      });
      toast.success("Accepted — waiting for HOD approval before it appears in your schedule");
    } else {
      toast.success("Compensation declined");
    }
    qc.invalidateQueries();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const accepted = rows.filter((r) => r.status === "accepted");
  const handled = rows.filter((r) => r.status !== "pending");
  const pendingIncoming = incomingOffers.filter((o) => o.status === "pending");
  const hodPendingIncoming = incomingOffers.filter((o) => o.status === "hod_pending");

  // Stats
  const totalAccepted = rows.filter((r) => r.status === "accepted").length;
  const totalDeclined = rows.filter((r) => r.status === "rejected").length;
  const totalPending = pending.length;

  // Pagination for proxy history
  const PROXY_PAGE_SIZE = 10;
  const [proxyHistPage, setProxyHistPage] = useState(1);
  const proxyHistTotalPages = Math.max(1, Math.ceil(handled.length / PROXY_PAGE_SIZE));
  const pagedHandled = handled.slice((proxyHistPage - 1) * PROXY_PAGE_SIZE, proxyHistPage * PROXY_PAGE_SIZE);

  // Pagination for outgoing comp offers
  const COMP_PAGE_SIZE = 10;
  const [compPage, setCompPage] = useState(1);

  // ── Offer Compensation filters ──────────────────────────────────────────────
  const [offerSearch, setOfferSearch] = useState("");
  const [offerCompStatus, setOfferCompStatus] = useState<"all" | "pending" | "offered">("all");
  const [offerDateFrom, setOfferDateFrom] = useState("");
  const [offerDateTo, setOfferDateTo] = useState("");
  const [offerPage, setOfferPage] = useState(1);
  const OFFER_PAGE_SIZE = 5;

  const filteredAccepted = useMemo(() => {
    let list = accepted as any[];
    if (offerSearch.trim()) {
      const q = offerSearch.toLowerCase();
      list = list.filter((r) =>
        r.absentee?.full_name?.toLowerCase().includes(q) ||
        r.subject?.toLowerCase().includes(q) ||
        r.class_name?.toLowerCase().includes(q)
      );
    }
    if (offerDateFrom) list = list.filter((r) => r.proxy_date >= offerDateFrom);
    if (offerDateTo) list = list.filter((r) => r.proxy_date <= offerDateTo);
    // offerCompStatus filters whether a comp offer has already been sent
    // We can't easily know at this point without fetching — handled at CompensationForm level
    // So we expose "all" and future status can be extended
    return list;
  }, [accepted, offerSearch, offerDateFrom, offerDateTo]);

  // Reset to page 1 whenever filters change
  const prevOfferFilters = useMemo(() => ({ offerSearch, offerDateFrom, offerDateTo, offerCompStatus }), [offerSearch, offerDateFrom, offerDateTo, offerCompStatus]);
  const offerTotalPages = Math.max(1, Math.ceil(filteredAccepted.length / OFFER_PAGE_SIZE));
  const pagedAccepted = filteredAccepted.slice((offerPage - 1) * OFFER_PAGE_SIZE, offerPage * OFFER_PAGE_SIZE);

  function clearOfferFilters() {
    setOfferSearch("");
    setOfferDateFrom("");
    setOfferDateTo("");
    setOfferCompStatus("all");
    setOfferPage(1);
  }

  // Reset to page 1 whenever offer filters change
  useEffect(() => { setOfferPage(1); }, [offerSearch, offerDateFrom, offerDateTo, offerCompStatus]);

  // Realtime: invalidate proxy + compensation queries instantly on any DB change
  // so the 60s polling interval doesn't cause stale UI
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`proxies-rt-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "proxy_assignments" }, () => {
        qc.invalidateQueries({ queryKey: ["my-proxies", profile.id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "compensation_assignments" }, () => {
        qc.invalidateQueries({ queryKey: ["my-comp-offers", profile.id] });
        qc.invalidateQueries({ queryKey: ["incoming-comp-offers", profile.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, qc]);

  if (rowsLoading) {
    return (
      <AppShell title={t("nav.proxies")} subtitle="Lectures your HOD has assigned you to cover">
        <ListSkeleton rows={4} />
      </AppShell>
    );
  }

  return (
    <AppShell title={t("nav.proxies")} subtitle="Lectures your HOD has assigned you to cover">
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

        {/* Incoming compensation offers — awaiting HOD approval */}
        {hodPendingIncoming.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <Gift className="size-4 text-warning" />
              <h2 className="font-semibold text-sm">Compensation — Awaiting HOD Approval</h2>
              <span className="ml-1 rounded-full bg-warning/15 text-warning text-xs font-bold px-2 py-0.5">{hodPendingIncoming.length}</span>
            </div>
            <ul className="space-y-3">
              {hodPendingIncoming.map((o) => (
                <li key={o.id} className="rounded-xl border border-warning/25 bg-warning/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15">
                      <Gift className="size-4 text-warning" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">From {o.from_teacher?.full_name ?? "a colleague"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Compensation on {fmtDate(o.compensation_date)}</p>
                      {o.note && <p className="text-xs text-muted-foreground mt-0.5 italic">"{o.note}"</p>}
                      <p className="text-xs text-warning font-medium mt-1.5">You accepted — waiting for your HOD to approve before it appears in your schedule.</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}


        {accepted.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <UserCheck className="size-4 text-info" />
              <h2 className="font-semibold text-sm">Offer compensation</h2>
            </div>
            <p className="text-xs text-muted-foreground -mt-1 mb-3">You've covered someone's leave — offer one of your lectures as compensation.</p>

            {/* Filters */}
            <div className="rounded-xl border border-border bg-muted/30 p-3 mb-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                {/* Search */}
                <div className="flex flex-col gap-0.5 flex-1 min-w-[160px]">
                  <label htmlFor="offer-search" className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">Search</label>
                  <div className="relative">
                    <input
                      id="offer-search"
                      className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="Teacher / subject…"
                      value={offerSearch}
                      onChange={(e) => setOfferSearch(e.target.value)}
                    />
                    <svg className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                  </div>
                </div>
                {/* Date from */}
                <div className="flex flex-col gap-0.5">
                  <label htmlFor="offer-date-from" className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">From</label>
                  <input
                    id="offer-date-from"
                    type="date"
                    className="h-8 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                    value={offerDateFrom}
                    onChange={(e) => setOfferDateFrom(e.target.value)}
                  />
                </div>
                {/* Date to */}
                <div className="flex flex-col gap-0.5">
                  <label htmlFor="offer-date-to" className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-0.5">To</label>
                  <input
                    id="offer-date-to"
                    type="date"
                    className="h-8 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                    value={offerDateTo}
                    onChange={(e) => setOfferDateTo(e.target.value)}
                  />
                </div>
                {/* Clear */}
                {(offerSearch || offerDateFrom || offerDateTo) && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] invisible">x</span>
                    <button
                      className="h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
                      onClick={clearOfferFilters}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
              {filteredAccepted.length !== accepted.length && (
                <p className="text-xs text-muted-foreground">{filteredAccepted.length} of {accepted.length} entries shown</p>
              )}
            </div>

            {filteredAccepted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 py-8 text-center">
                <p className="text-sm text-muted-foreground">No entries match your filters.</p>
              </div>
            ) : (
              <>
                <ul className="space-y-4">
                  {pagedAccepted.map((r: any) => (
                    <CompensationForm
                      key={r.id}
                      proxyRow={r}
                      myLectures={myLectures}
                      today={today}
                      onDone={() => qc.invalidateQueries()}
                    />
                  ))}
                </ul>
                {offerTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
                    <Pagination page={offerPage} totalPages={offerTotalPages} onPage={setOfferPage} totalItems={filteredAccepted.length} pageSize={OFFER_PAGE_SIZE} />
                  </div>
                )}\
              </>
            )}
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
            <>
              {/* ── Mobile card list ── */}
              <div className="flex flex-col gap-2 sm:hidden">
                {pagedHandled.map((r) => (
                  <div key={r.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{r.subject} <span className="text-muted-foreground font-normal">· {r.class_name}</span></p>
                        <p className="text-xs text-muted-foreground mt-0.5">Covering: {r.absentee?.full_name ?? "—"}</p>
                      </div>
                      <Badge
                        variant={r.status === "accepted" ? "default" : "secondary"}
                        className={`shrink-0 ${r.status === "accepted" ? "bg-success/15 text-success border-success/25" : ""}`}
                      >
                        {r.status === "accepted" ? "Accepted" : "Declined"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{fmtDate(r.proxy_date)}</span>
                      <span className="text-border">·</span>
                      <span>{fmtTime(r.start_time)} – {fmtTime(r.end_time)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Desktop table ── */}
              <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
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
                    {pagedHandled.map((r, i) => (
                      <tr key={r.id} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{fmtDate(r.proxy_date)}</td>
                        <td className="px-4 py-3">{r.subject} <span className="text-muted-foreground">· {r.class_name}</span></td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtTime(r.start_time)} – {fmtTime(r.end_time)}</td>
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

              <Pagination page={proxyHistPage} totalPages={proxyHistTotalPages} onPage={setProxyHistPage} totalItems={handled.length} pageSize={PROXY_PAGE_SIZE} className="mt-1" />
            </>
          )}
        </div>

        {/* My outgoing compensation offers */}
        {myCompOffers.length > 0 && (() => {
          const compTotalPages = Math.max(1, Math.ceil(myCompOffers.length / COMP_PAGE_SIZE));
          const pagedComp = myCompOffers.slice((compPage - 1) * COMP_PAGE_SIZE, compPage * COMP_PAGE_SIZE);
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Gift className="size-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm">My compensation offers</h2>
              </div>

              {/* ── Mobile card list ── */}
              <div className="flex flex-col gap-2 sm:hidden">
                {pagedComp.map((o) => {
                  const statusLabel = o.status === "accepted" ? "Approved" : o.status === "rejected" ? "Declined" : o.status === "hod_pending" ? "Awaiting HOD" : "Pending";
                  const statusClass = o.status === "accepted" ? "bg-success/15 text-success border-success/25" : o.status === "hod_pending" ? "bg-warning/15 text-warning border-warning/25" : "";
                  const statusVariant: "default" | "destructive" | "secondary" = o.status === "accepted" ? "default" : o.status === "rejected" ? "destructive" : "secondary";
                  return (
                    <div key={o.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">To: {o.to_teacher?.full_name ?? "colleague"}</p>
                          {o.note && <p className="text-xs text-muted-foreground italic mt-0.5">"{o.note}"</p>}
                        </div>
                        <Badge variant={statusVariant} className={`shrink-0 ${statusClass}`}>{statusLabel}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{fmtDate(o.compensation_date)}</p>
                    </div>
                  );
                })}
              </div>

              {/* ── Desktop table ── */}
              <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-semibold">To</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Note</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedComp.map((o, i) => (
                      <tr key={o.id} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="px-4 py-3 font-medium">{o.to_teacher?.full_name ?? "colleague"}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(o.compensation_date)}</td>
                        <td className="px-4 py-3 text-muted-foreground italic">{o.note ? `"${o.note}"` : "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <Badge
                            variant={o.status === "accepted" ? "default" : o.status === "rejected" ? "destructive" : "secondary"}
                            className={o.status === "accepted" ? "bg-success/15 text-success border-success/25" : o.status === "hod_pending" ? "bg-warning/15 text-warning border-warning/25" : ""}
                          >
                            {o.status === "accepted" ? "Approved" : o.status === "rejected" ? "Declined" : o.status === "hod_pending" ? "Awaiting HOD" : "Pending"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination page={compPage} totalPages={compTotalPages} onPage={setCompPage} totalItems={myCompOffers.length} pageSize={COMP_PAGE_SIZE} className="mt-1" />
            </div>
          );
        })()}
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