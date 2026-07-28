import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/leave";

export const Route = createFileRoute("/holidays")({
  head: () => ({
    meta: [
      { title: "Holiday Calendar — CSC Leave Management" },
      {
        name: "description",
        content: "College holiday calendar: Sundays and national holidays never cut pay.",
      },
      { property: "og:title", content: "Holiday Calendar — CSC Leave Management" },
      { property: "og:description", content: "National and college holidays for the year." },
    ],
  }),
  component: () => (
    <Guarded>
      <HolidaysPage />
    </Guarded>
  ),
});

function HolidaysPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ date: "", occasion: "" });

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
        .order("holiday_date");
      if (error) throw error;
      return data;
    },
  });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date || !form.occasion.trim()) return toast.error("Date and occasion are required");
    const { error } = await supabase
      .from("holidays")
      .insert({ holiday_date: form.date, occasion: form.occasion.trim() });
    if (error) return toast.error(error.message);
    setForm({ date: "", occasion: "" });
    toast.success("Holiday added");
    qc.invalidateQueries({ queryKey: ["holidays"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["holidays"] });
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.holiday_date >= today);
  const past = holidays.filter((h) => h.holiday_date < today);

  return (
    <AppShell
      title="Holiday Calendar"
      subtitle="Sundays and these holidays are never counted as leave"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <SectionCard title="Upcoming Holidays">
          {upcoming.length === 0 ? (
            <Empty>No upcoming holidays.</Empty>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
                >
                  <div>
                    <p className="font-semibold">{h.occasion}</p>
                    <p className="text-muted-foreground">{fmtDate(h.holiday_date)}</p>
                  </div>
                  {role === "principal" && (
                    <Button variant="ghost" size="sm" onClick={() => remove(h.id)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-6">
          {role === "principal" && (
            <SectionCard title="Add Holiday">
              <form onSubmit={add} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="hdate">Date</Label>
                  <Input
                    id="hdate"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="occ">Occasion</Label>
                  <Input
                    id="occ"
                    placeholder="Diwali"
                    value={form.occasion}
                    onChange={(e) => setForm({ ...form, occasion: e.target.value })}
                  />
                </div>
                <Button type="submit" className="w-full">
                  Add holiday
                </Button>
              </form>
            </SectionCard>
          )}

          <SectionCard title="Past Holidays">
            {past.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {past.slice(-12).map((h) => (
                  <li key={h.id} className="flex justify-between">
                    <span>{h.occasion}</span>
                    <span>{fmtDate(h.holiday_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
