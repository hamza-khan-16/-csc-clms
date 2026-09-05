import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Lightweight markdown renderer for notice bodies:
// **bold**, *italic*, - bullet lists, URLs auto-linked
function renderNoticeBody(text: string): React.ReactNode {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        // Bullet list item
        const isBullet = /^[-•*]\s+/.test(line);
        const content = isBullet ? line.replace(/^[-•*]\s+/, "") : line;

        // Inline formatting: **bold**, *italic*, URLs
        const parts: React.ReactNode[] = [];
        let remaining = content;
        let idx = 0;

        const PATTERNS: [RegExp, (m: string, g: string) => React.ReactNode][] = [
          [/\*\*(.+?)\*\*/g, (_, g) => <strong key={idx++} className="font-semibold">{g}</strong>],
          [/\*(.+?)\*/g,      (_, g) => <em key={idx++} className="italic">{g}</em>],
          [/https?:\/\/[^\s]+/g, (m) => <a key={idx++} href={m} target="_blank" rel="noopener noreferrer" className="underline text-primary">{m}</a>],
        ];

        let lastStr = remaining;
        // Simple single-pass: bold → italic → url
        const segments: React.ReactNode[] = [];
        const combined = /\*\*(.+?)\*\*|\*(.+?)\*|https?:\/\/[^\s]+/g;
        let last = 0;
        let match;
        while ((match = combined.exec(content)) !== null) {
          if (match.index > last) segments.push(content.slice(last, match.index));
          if (match[0].startsWith("**")) segments.push(<strong key={idx++} className="font-semibold">{match[1]}</strong>);
          else if (match[0].startsWith("*"))  segments.push(<em key={idx++} className="italic">{match[2]}</em>);
          else segments.push(<a key={idx++} href={match[0]} target="_blank" rel="noopener noreferrer" className="underline text-primary">{match[0]}</a>);
          last = match.index + match[0].length;
        }
        if (last < content.length) segments.push(content.slice(last));

        const node = segments.length ? <>{segments}</> : <>{content}</>;

        if (isBullet) return (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-1 size-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
            <span>{node}</span>
          </div>
        );
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <div key={i}>{node}</div>;
      })}
    </div>
  );
}

import { CalendarClock, CalendarDays, CheckCheck, ChevronDown, ChevronUp, ClipboardList, Trash2 } from "lucide-react";
import { validateMeaningfulText, liveTextHint } from "@/lib/validateText";
import { GuardedInput, GuardedTextarea } from "@/components/GuardedField";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { firePush } from "@/lib/push.functions";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate, fmtTime } from "@/lib/leave";


export const Route = createFileRoute("/notices")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Notices — CSC Leave Management" },
      {
        name: "description",
        content:
          "Post notices to teachers. A HOD reaches their own department, the principal reaches every department.",
      },
      { property: "og:title", content: "Notices — CSC Leave Management" },
      { property: "og:description", content: "Notice board for HODs and the principal." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <NoticesPage />
    </Guarded>
  ),
});

function NoticesPage() {
  const { profile, role } = useAuth();
  const qc = useQueryClient();
  const isPrincipal = role === "principal";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Fetch which notices this user has already read from Supabase
  useQuery({
    queryKey: ["notice-reads", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("notice_reads")
        .select("notice_id")
        .eq("user_id", profile!.id);
      if (error) throw error;
      setReadIds(new Set((data ?? []).map((r: any) => r.notice_id)));
      return data;
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-list"],
    enabled: isPrincipal,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: notices = [] } = useQuery({
    queryKey: ["notices"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Auto-delete notices whose event_date has passed
      await supabase
        .from("notices")
        .delete()
        .not("event_date", "is", null)
        .lt("event_date", today);

      const { data, error } = await supabase
        .from("notices")
        .select("id, title, body, department_id, created_by, created_at, event_date, event_time, departments(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return toast.error("Give the notice a title");
    const titleCheck = validateMeaningfulText(title, "Title", true);
    if (!titleCheck.valid) return toast.error(titleCheck.error!);
    if (body.trim()) {
      const bodyCheck = validateMeaningfulText(body, "Details");
      if (!bodyCheck.valid) return toast.error(bodyCheck.error!);
    }
    // Validate event date is not in the past
    if (eventDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const chosen = new Date(eventDate);
      if (chosen < today) return toast.error("Event date cannot be in the past");
    }
    const departmentId = isPrincipal
      ? scope === "all"
        ? null
        : scope
      : (profile!.department_id ?? null);
    if (!isPrincipal && !departmentId) return toast.error("You are not linked to a department");

    setBusy(true);
    const { error } = await supabase.from("notices").insert({
      title: title.trim(),
      body: body.trim() || undefined,
      department_id: departmentId,
      created_by: profile!.id,
      event_date: eventDate || null,
      event_time: eventTime || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    // Notify recipients — exclude the poster themselves
    // departmentId = null means college-wide (principal posting to all)
    const recipientIds = departmentId
      ? [
          `__dept_teachers_${departmentId}__`,  // all teachers in dept
          `__hod_dept_${departmentId}__`,        // HOD of that dept
          "__principal__",                        // principal always gets notices
        ]
      : [
          "__teacher__",   // all teachers
          "__hod__",       // all HODs
          "__hr__",        // HR staff
          "__principal__", // principal (if another principal/admin posts)
        ];
    firePush({
      userIds: recipientIds,
      title: "New Notice",
      body: title.trim(),
      targetUrl: "/notices",
      excludeUserIds: profile?.id ? [profile.id] : [],
    });
    setTitle("");
    setBody("");
    setEventDate("");
    setEventTime("");
    toast.success("Notice published");
    qc.invalidateQueries({ queryKey: ["notices"] });
    qc.invalidateQueries({ queryKey: ["navbar-notices"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("notices").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["notices"] });
    qc.invalidateQueries({ queryKey: ["navbar-notices"] });
  }

  return (
    <AppShell
      title="Notices"
      subtitle={
        isPrincipal
          ? "Publish to all departments or a single department"
          : `Published to ${profile?.department_name ?? "your department"} teachers`
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <SectionCard
          title="Published notices"
          subtitle={notices.length > 0 ? `${notices.length} active notice${notices.length !== 1 ? "s" : ""}` : "No active notices"}
        >
          {notices.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <div className="size-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                <ClipboardList className="size-6 text-muted-foreground"/>
              </div>
              <div>
                <p className="font-semibold text-sm">No notices yet</p>
                <p className="text-xs text-muted-foreground mt-1">Published notices will appear here for all teachers to read.</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground px-4 py-3 max-w-xs mx-auto text-left space-y-1">
                <p className="font-semibold text-foreground">Tips for good notices:</p>
                <p>• Keep titles short and clear</p>
                <p>• Add an event date for scheduled events</p>
                <p>• Notices with past event dates are auto-removed</p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {notices.map((n) => {
                const hasEvent = n.event_date;
                const isLong = (n.body?.length ?? 0) > 120;
                return (
                  <NoticeCard
                    key={n.id}
                    notice={n}
                    hasEvent={!!hasEvent}
                    isLong={isLong}
                    canDelete={n.created_by === profile?.id || role === "admin"}
                    onDelete={() => remove(n.id)}
                    userId={profile?.id}
                    isRead={readIds.has(n.id)}
                    onAck={(id) => setReadIds(prev => new Set([...prev, id]))}
                  />
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="New notice">
          <form onSubmit={post} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="notice-title">Title</Label>
              <GuardedInput
                id="notice-title"
                fieldName="Title"
                maxLength={120}
                placeholder="Staff meeting on Friday"
                value={title}
                onChange={setTitle}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notice-body">Details <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <GuardedTextarea
                id="notice-body"
                fieldName="Details"
                rows={4}
                maxLength={600}
                placeholder="Add the details teachers should see..."
                value={body}
                onChange={setBody}
              />
              <p className="text-[10px] text-muted-foreground">
                Tip: Use <code className="bg-muted px-1 rounded">**bold**</code>, <code className="bg-muted px-1 rounded">*italic*</code>, or <code className="bg-muted px-1 rounded">- bullet</code> for formatting.
              </p>
            </div>

            {/* Event date / time — optional */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <CalendarClock className="size-3.5" /> Event date &amp; time <span className="font-normal normal-case">(optional)</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    value={eventDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Time</Label>
                  <Input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="h-8 text-sm"
                    disabled={!eventDate}
                  />
                </div>
              </div>
              {eventDate && (
                <p className="text-xs text-primary flex items-center gap-1.5">
                  <CalendarDays className="size-3 shrink-0" /> Notice will show event on {fmtDate(eventDate)}{eventTime ? ` at ${fmtTime(eventTime)}` : ""}
                </p>
              )}
            </div>

            {isPrincipal && (
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              Publish notice
            </Button>
          </form>
        </SectionCard>
      </div>
    </AppShell>
  );
}

type NoticeRow = { id: string; title: string; body: string | null; event_date: string | null; event_time: string | null; created_at: string; created_by: string | null; departments: { name: string } | null };

function NoticeCard({ notice: n, hasEvent, isLong, canDelete, onDelete, userId, isRead, onAck }: {
  notice: NoticeRow; hasEvent: boolean; isLong: boolean; canDelete: boolean; onDelete: () => void;
  userId: string | undefined; isRead: boolean; onAck: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acked, setAcked] = useState(isRead);

  async function acknowledge() {
    if (!userId) return;
    const { error } = await (supabase as any)
      .from("notice_reads")
      .upsert({ user_id: userId, notice_id: n.id }, { onConflict: "user_id,notice_id" });
    if (error) return toast.error("Could not mark as read");
    setAcked(true);
    onAck(n.id);
    toast.success("Notice acknowledged");
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fmtTime = (t: string) => { const [h, m] = t.split(":"); const hr = Number(h); return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`; };

  return (
    <li className={`rounded-lg border p-4 space-y-2 ${hasEvent ? "border-primary/30 bg-primary/5" : "border-border"} ${acked ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-snug line-clamp-2">{n.title}</p>
          {n.body && (
            <>
              <div className={`mt-1 text-sm text-muted-foreground ${!expanded && isLong ? "line-clamp-2" : ""}`}>
                {expanded || !isLong ? renderNoticeBody(n.body) : n.body}
              </div>
              {isLong && (
                <button onClick={() => setExpanded((e) => !e)} className="mt-1 flex items-center gap-0.5 text-xs text-primary font-medium">
                  {expanded ? <><ChevronUp className="size-3" /> Show less</> : <><ChevronDown className="size-3" /> Read more</>}
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!acked && userId && (
            <Button variant="ghost" size="icon" className="size-8 text-success" title="Mark as read" onClick={acknowledge}>
              <CheckCheck className="size-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={onDelete}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Posted {fmtDate(n.created_at)}</span>
        <span>·</span>
        <span>{n.departments?.name ?? "All departments"}</span>
        {hasEvent && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1 font-medium text-primary">
              Event: {fmtDate(n.event_date!)}
              {n.event_time && ` at ${fmtTime(n.event_time)}`}
            </span>
          </>
        )}
        {acked && <span className="ml-auto text-success flex items-center gap-1"><CheckCheck className="size-3" /> Read</span>}
      </div>
    </li>
  );
}
