import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtDate } from "@/lib/leave";
import type { AppRole } from "@/lib/auth";

export function NoticeBell({ role }: { role: AppRole | null }) {
  const [open, setOpen] = useState(false);

  const { data: notices = [] } = useQuery({
    queryKey: ["navbar-notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("id, title, body, department_id, created_at, departments(name)")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notices">
          <Bell className="size-5" />
          {notices.length > 0 && (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-bold">Notices</p>
          {(role === "hod" || role === "principal") && (
            <Button asChild variant="ghost" size="sm" onClick={() => setOpen(false)}>
              <Link to="/notices">Manage</Link>
            </Button>
          )}
        </div>
        {notices.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notices yet.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {notices.map((n) => (
              <li key={n.id} className="border-b border-border px-3 py-2.5 last:border-b-0">
                <p className="text-sm font-semibold">{n.title}</p>
                {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fmtDate(new Date(n.created_at))} ·{" "}
                  {(n.departments as { name: string } | null)?.name ?? "All departments"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
