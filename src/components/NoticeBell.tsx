import { useState, useEffect, useRef } from "react";
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

// Per-user key — prevents cross-user read state bleed on shared devices
function seenKey(userId?: string) { return userId ? `notif_seen_ids_${userId}` : "notif_seen_ids"; }

function getSeenIds(userId?: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveSeenIds(ids: Set<string>, userId?: string) {
  try {
    const arr = [...ids].slice(-200);
    localStorage.setItem(seenKey(userId), JSON.stringify(arr));
  } catch {}
}

export function NoticeBell({ role, userId }: { role: AppRole | null; userId?: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [seenIds, setSeenIds] = useState<Set<string>>(() => getSeenIds(userId));
  const prevCountRef = useRef(0);

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

  // My recent leave status changes
  const { data: leaveActivity = [] } = useQuery({
    queryKey: ["notif-leaves", userId],
    enabled: !!userId && (role === "teacher" || role === "hod"),
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("id, leave_type, status, from_date, updated_at")
        .eq("teacher_id", userId!)
        .in("status", ["approved", "hod_approved", "rejected", "hod_recommended"])
        .order("updated_at", { ascending: false })
        .limit(8);
      return (data ?? []).map((l) => ({
        kind: "leave" as const,
        id: `leave-${l.id}-${l.status}`,
        title: `Leave ${l.status.replace(/_/g, " ")} — ${fmtDate(l.from_date)}`,
        status: l.status,
        created_at: (l as any).updated_at ?? l.from_date,
      }));
    },
  });

  // Proxy assignments
  const { data: proxyActivity = [] } = useQuery({
    queryKey: ["notif-proxies", userId],
    enabled: !!userId && (role === "teacher" || role === "hod"),
    staleTime: 60_000,
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data } = await supabase
        .from("proxy_assignments")
        .select("id, subject, proxy_date, created_at")
        .eq("proxy_teacher_id", userId!)
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []).map((p) => ({
        kind: "proxy" as const,
        id: `proxy-${p.id}`,
        title: `Proxy assigned — ${p.subject ?? "lecture"} on ${fmtDate(p.proxy_date)}`,
        date: p.proxy_date,
        created_at: p.created_at,
      }));
    },
  });

  // Doc status changes
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
        id: `doc-${d.id}-${d.status}`,
        title: `Document ${d.status} — ${d.doc_type.replace(/_/g, " ")}`,
        status: d.status,
        created_at: d.reviewed_at ?? "",
      }));
    },
  });

  // Realtime leave updates
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notif-leave-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leave_requests", filter: `teacher_id=eq.${userId}` },
        () => { qc.invalidateQueries({ queryKey: ["notif-leaves", userId] }); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);

  // Merge + sort all items
  const noticeItems: ActivityItem[] = notices.map((n) => ({
    kind: "notice" as const,
    id: `notice-${n.id}`,
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

  const unreadCount = allItems.filter((i) => !seenIds.has(i.id)).length;

  // Mark a single item as read
  function markRead(id: string) {
    setSeenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSeenIds(next, userId);
      return next;
    });
  }

  // Mark all as read
  function markAllRead() {
    setSeenIds((prev) => {
      const next = new Set(prev);
      allItems.forEach((i) => next.add(i.id));
      saveSeenIds(next, userId);
      return next;
    });
  }

  function handleOpen(v: boolean) {
    setOpen(v);
    // Don't auto-mark-all-read — user dismisses each item individually
  }

  // Notify badge when count changes (new items arrived via realtime)
  useEffect(() => {
    if (unreadCount > prevCountRef.current && !open) {
      // New unread items arrived — badge will show automatically
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount, open]);

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
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                Mark all read
              </Button>
            )}
            {(role === "hod" || role === "principal" || role === "admin") && (
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                <Link to="/notices">Manage</Link>
              </Button>
            )}
          </div>
        </div>
        {allItems.filter((item) => !seenIds.has(item.id)).length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">All caught up!</p>
            <Link to="/notices" className="text-xs text-accent mt-1 inline-block" onClick={() => setOpen(false)}>View notices →</Link>
          </div>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto divide-y divide-border">
            {allItems.filter((item) => !seenIds.has(item.id)).map((item) => (
              <li
                key={item.id}
                className="px-3 py-2.5 flex items-start gap-2.5 bg-primary/5 hover:bg-primary/10 transition-colors"
              >
                <div className="mt-0.5 shrink-0">{iconFor(item)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-snug line-clamp-2 font-semibold">{item.title}</p>
                  {item.kind === "notice" && item.body && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{item.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {item.created_at ? fmtDate(item.created_at.slice(0, 10)) : ""}
                    {item.kind === "notice" && item.dept ? ` · ${item.dept}` : ""}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); markRead(item.id); }}
                  className="mt-0.5 shrink-0 rounded-full p-1 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                  title="Mark as read"
                  aria-label="Mark as read"
                >
                  <CheckCircle2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
