import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, ClipboardCheck, FileText, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtDate } from "@/lib/leave";
import type { AppRole } from "@/lib/auth";

type ActivityItem =
  | { kind: "notice";  id: string; title: string; body: string | null; dept: string | null; created_at: string }
  | { kind: "leave";   id: string; title: string; status: string; created_at: string }
  | { kind: "proxy";   id: string; title: string; date: string; created_at: string }
  | { kind: "doc";     id: string; title: string; status: string; created_at: string };

const SEEN_KEY = "notif_seen_at";

export function NoticeBell({ role, userId }: { role: AppRole | null; userId?: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [seenAt, setSeenAt] = useState<number>(() => {
    try { return Number(localStorage.getItem(SEEN_KEY) ?? "0"); } catch { return 0; }
  });

  // Notices
  const { data: notices = [] } = useQuery({
    queryKey: ["navbar-notices"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("notices")
        .select("id, title, body, department_id, created_at, departments(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  // My recent leave status changes (teachers/hod)
  const { data: leaveActivity = [] } = useQuery({
    queryKey: ["notif-leaves", userId],
    enabled: !!userId && (role === "teacher" || role === "hod"),
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("id, leave_type, status, from_date")
        .eq("teacher_id", userId!)
        .in("status", ["approved", "hod_approved", "rejected", "hod_recommended"])
        .order("from_date", { ascending: false })
        .limit(8);
      return (data ?? []).map((l) => ({
        kind: "leave" as const,
        id: l.id,
        title: `Leave ${l.status.replace(/_/g, " ")} — ${fmtDate(l.from_date)}`,
        status: l.status,
        created_at: l.from_date,
      }));
    },
  });

  // Proxy assignments (teachers/hod)
  const { data: proxyActivity = [] } = useQuery({
    queryKey: ["notif-proxies", userId],
    enabled: !!userId && (role === "teacher" || role === "hod"),
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("proxy_assignments")
        .select("id, subject, proxy_date, created_at")
        .eq("proxy_teacher_id", userId!)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []).map((p) => ({
        kind: "proxy" as const,
        id: p.id,
        title: `Proxy assigned — ${p.subject ?? "lecture"} on ${fmtDate(p.proxy_date)}`,
        date: p.proxy_date,
        created_at: p.created_at,
      }));
    },
  });

  // Doc status changes (teachers)
  const { data: docActivity = [] } = useQuery({
    queryKey: ["notif-docs", userId],
    enabled: !!userId && role === "teacher",
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("teacher_documents")
        .select("id, doc_type, status, reviewed_at")
        .eq("teacher_id", userId!)
        .in("status", ["approved", "rejected"])
        .order("reviewed_at", { ascending: false })
        .limit(5);
      return (data ?? []).map((d) => ({
        kind: "doc" as const,
        id: d.id,
        title: `Document ${d.status} — ${d.doc_type.replace(/_/g, " ")}`,
        status: d.status,
        created_at: d.reviewed_at ?? "",
      }));
    },
  });

  // Realtime: refresh activity on leave_requests changes for this user
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notif-leave-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leave_requests", filter: `teacher_id=eq.${userId}` },
        () => { qc.invalidateQueries({ queryKey: ["notif-leaves", userId] }); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);

  // Merge + sort all activities
  const noticeItems: ActivityItem[] = notices.map((n) => ({
    kind: "notice" as const,
    id: n.id,
    title: n.title,
    body: n.body,
    dept: (n.departments as { name: string } | null)?.name ?? null,
    created_at: n.created_at,
  }));

  const allItems: ActivityItem[] = [
    ...noticeItems,
    ...leaveActivity,
    ...proxyActivity,
    ...docActivity,
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
   .slice(0, 20);

  const unreadCount = allItems.filter((i) => new Date(i.created_at).getTime() > seenAt).length;

  function markAllRead() {
    const now = Date.now();
    setSeenAt(now);
    try { localStorage.setItem(SEEN_KEY, String(now)); } catch {}
  }

  function handleOpen(v: boolean) {
    setOpen(v);
    if (v) markAllRead();
  }

  const iconFor = (item: ActivityItem) => {
    if (item.kind === "notice") return <Bell className="size-3.5 text-info" />;
    if (item.kind === "leave")  return <CalendarDays className="size-3.5 text-warning-foreground" />;
    if (item.kind === "proxy")  return <ClipboardCheck className="size-3.5 text-primary" />;
    if (item.kind === "doc")    return <FileText className="size-3.5 text-success" />;
    return <CheckCircle2 className="size-3.5" />;
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-16px)] max-w-80 p-0 sm:w-80">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-bold">Notifications</p>
          <div className="flex items-center gap-1">
            {(role === "hod" || role === "principal" || role === "admin") && (
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                <Link to="/notices">Manage notices</Link>
              </Button>
            )}
          </div>
        </div>
        {allItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">All caught up!</p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto divide-y divide-border">
            {allItems.map((item) => {
              const isNew = new Date(item.created_at).getTime() > seenAt;
              return (
                <li key={`${item.kind}-${item.id}`}
                    className={`px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-muted/50 ${isNew ? "bg-primary/5" : ""}`}>
                  <div className="mt-0.5 shrink-0">{iconFor(item)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-snug line-clamp-2">{item.title}</p>
                    {item.kind === "notice" && item.body && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{item.body}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {item.created_at ? fmtDate(item.created_at.slice(0, 10)) : ""}
                      {item.kind === "notice" && item.dept ? ` · ${item.dept}` : ""}
                    </p>
                  </div>
                  {isNew && <span className="mt-1.5 size-2 rounded-full bg-primary shrink-0" />}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
