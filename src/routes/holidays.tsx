import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/leave";
import { CalendarDays, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/holidays")({
  head: () => ({
    meta: [
      { title: "Holiday Calendar — CSC Leave Management" },
      { name: "description", content: "Indian public holidays 2025–2030." },
      { property: "og:title", content: "Holiday Calendar — CSC Leave Management" },
    ],
  }),
  component: () => (
    <Guarded>
      <HolidaysPage />
    </Guarded>
  ),
});

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function HolidaysPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const isPrincipal = role === "principal" || role === "admin";
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const [viewYear, setViewYear] = useState(currentYear);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ date: "", occasion: "", kind: "College" });

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays", viewYear],
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("id, holiday_date, occasion, kind, source")
        .gte("holiday_date", `${viewYear}-01-01`)
        .lte("holiday_date", `${viewYear}-12-31`)
        .order("holiday_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Group by month
  const byMonth: Record<number, typeof holidays> = {};
  for (const h of holidays) {
    const m = new Date(h.holiday_date + "T00:00:00").getMonth();
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(h);
  }

  const upcoming = holidays.filter((h) => h.holiday_date >= today);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["holidays"] });
    qc.invalidateQueries({ queryKey: ["holidays-all"] });
    qc.invalidateQueries({ queryKey: ["upcoming-holidays"] });
    qc.invalidateQueries({ queryKey: ["month-calendar"] });
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["monthly-schedule"] });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date || !form.occasion.trim()) return toast.error("Date and occasion are required");
    const { error } = await supabase.from("holidays").upsert(
      { holiday_date: form.date, occasion: form.occasion.trim(), kind: form.kind, source: "manual" },
      { onConflict: "holiday_date" },
    );
    if (error) return toast.error(error.message);
    setForm({ date: "", occasion: "", kind: "College" });
    setAddOpen(false);
    toast.success("Holiday added — will be excluded from leave counts immediately");
    invalidateAll();
  }

  async function remove(id: string, source: string) {
    if (source === "system") {
      if (!window.confirm("This is a pre-loaded national holiday. Remove it?")) return;
    }
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Holiday removed");
    invalidateAll();
  }

  return (
    <AppShell
      title="Holiday Calendar"
      subtitle="Indian public holidays 2025–2030 · Sundays and holidays are never counted as leave days"
    >
      <div className="space-y-5">

        {/* Year nav + stats bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{holidays.length}</strong> holidays in {viewYear}
            {upcoming.length > 0 && viewYear === currentYear && (
              <> · <strong className="text-foreground">{upcoming.length}</strong> upcoming</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewYear((y) => y - 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              ‹ {viewYear - 1}
            </button>
            <span className="font-bold text-sm w-12 text-center">{viewYear}</span>
            <button
              onClick={() => setViewYear((y) => y + 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              {viewYear + 1} ›
            </button>
          </div>
        </div>

        {/* Upcoming strip */}
        {upcoming.length > 0 && viewYear === currentYear && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Next upcoming</p>
            <div className="flex flex-wrap gap-2">
              {upcoming.slice(0, 5).map((h) => (
                <div key={h.id} className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-background px-3 py-1.5 text-xs">
                  <CalendarDays className="size-3 text-primary shrink-0" />
                  <span className="font-medium">{h.occasion}</span>
                  <span className="text-muted-foreground">{fmtDate(h.holiday_date)}</span>
                </div>
              ))}
              {upcoming.length > 5 && (
                <span className="flex items-center text-xs text-muted-foreground px-2">+{upcoming.length - 5} more</span>
              )}
            </div>
          </div>
        )}

        {/* Month grid */}
        {isLoading ? (
          <div className="rounded-xl border border-border p-12 text-center">
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          </div>
        ) : holidays.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <Empty>No holidays for {viewYear}.</Empty>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(byMonth)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([monthIdx, monthHolidays]) => (
                <div key={monthIdx} className="rounded-xl border border-border overflow-hidden">
                  <div className="bg-muted/60 px-4 py-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {MONTH_NAMES[Number(monthIdx)]}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {monthHolidays.length} holiday{monthHolidays.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {monthHolidays.map((h) => {
                      const d = new Date(h.holiday_date + "T00:00:00");
                      const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
                      const isPast = h.holiday_date < today;
                      const isSystem = h.source === "system" || h.source === "nager";
                      return (
                        <li key={h.id} className={`flex items-center gap-3 px-4 py-2.5 group ${isPast ? "opacity-45" : ""}`}>
                          <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted">
                            <span className="text-[10px] text-muted-foreground leading-none">{dow}</span>
                            <span className="text-sm font-bold leading-none mt-0.5">{d.getDate()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-snug truncate">{h.occasion}</p>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] px-1.5 py-0 leading-4 mt-0.5 ${
                                isSystem
                                  ? "bg-success/12 text-success border-success/20"
                                  : "bg-info/12 text-info border-info/20"
                              }`}
                            >
                              {isSystem ? "National" : h.kind ?? "Custom"}
                            </Badge>
                          </div>
                          {isPrincipal && (
                            <button
                              onClick={() => remove(h.id, h.source ?? "manual")}
                              className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/8 transition-all"
                              title="Remove"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
          </div>
        )}

        {/* Add custom holiday — principal only */}
        {isPrincipal && (
          <div>
            {!addOpen ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" /> Add custom holiday
              </Button>
            ) : (
              <div className="rounded-xl border border-border p-5 space-y-4 max-w-md">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">Add custom holiday</p>
                  <button onClick={() => setAddOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
                <form onSubmit={add} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" className="h-9 text-sm" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Occasion</Label>
                    <Input className="h-9 text-sm" placeholder="e.g. College Foundation Day" value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={form.kind}
                      onChange={(e) => setForm({ ...form, kind: e.target.value })}
                    >
                      <option value="College">College</option>
                      <option value="State">State</option>
                      <option value="National">National</option>
                    </select>
                  </div>
                  <Button type="submit" size="sm" className="w-full">Add holiday</Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  This holiday will appear in the calendar immediately and will be excluded from leave day counts.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground pt-2 border-t border-border">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-success/60" />
            National / pre-loaded holiday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-info/60" />
            Custom / college holiday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-muted-foreground/30" />
            Past (dimmed)
          </span>
        </div>
      </div>
    </AppShell>
  );
}
