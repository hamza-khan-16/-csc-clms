import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Badge } from "@/components/ui/badge";
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
import {
  GraduationCap, Calendar, BookOpen, TrendingUp,
  X, ChevronRight, Clock, UserCircle2, Edit3, Check,
} from "lucide-react";
import { fmtDate, leaveTypeLabel, type LeaveType } from "@/lib/leave";

export const Route = createFileRoute("/teachers")({
  head: () => ({
    meta: [
      { title: "Teachers — CSC Leave Management" },
      { name: "description", content: "Directory of teaching staff with department, designation and leave usage." },
      { property: "og:title", content: "Teachers — CSC Leave Management" },
      { property: "og:description", content: "Staff directory for HODs and the principal." },
    ],
  }),
  component: () => (
    <Guarded roles={["hod", "principal", "admin"]}>
      <TeachersPage />
    </Guarded>
  ),
});

function TeachersPage() {
  const { profile, role } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Fetch all departments for the filter dropdown (principal/admin only)
  const { data: departments = [] } = useQuery({
    queryKey: ["departments-list"],
    enabled: role !== "hod",
    queryFn: async () => {
      const { data } = await supabase.from("departments").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["staff", role, profile?.department_id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id, role")
        .in("role", ["admin", "principal"]);
      const excludedIds = new Set((adminRoles ?? []).map((r) => r.user_id));

      let q = supabase
        .from("profiles")
        .select("id, full_name, designation, department_id, date_of_joining, date_of_birth, gender, experience_years, subjects_taught, departments(name)")
        .order("full_name");
      if (role === "hod") q = q.eq("department_id", profile!.department_id ?? "");
      const { data, error } = await q;
      if (error) throw error;

      const year = new Date().getFullYear();
      const { data: leaves } = await supabase
        .from("leave_requests")
        .select("teacher_id, total_days, unpaid_days, leave_type, from_date, to_date, status")
        .in("status", ["approved", "hod_approved"])
        .gte("from_date", `${year}-01-01`);

      return (data ?? [])
        .filter((p) => !excludedIds.has(p.id))
        .map((p) => ({
          ...p,
          deptName: (p.departments as { name: string } | null)?.name ?? "—",
          taken: (leaves ?? []).filter((l) => l.teacher_id === p.id).reduce((s, l) => s + Number(l.total_days), 0),
          unpaid: (leaves ?? []).filter((l) => l.teacher_id === p.id).reduce((s, l) => s + Number(l.unpaid_days), 0),
          leaveHistory: (leaves ?? []).filter((l) => l.teacher_id === p.id),
        }));
    },
  });

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // Apply department filter + search
  const filtered = rows.filter((r) => {
    const matchDept = deptFilter === "all" || r.department_id === deptFilter;
    const matchSearch = !search.trim() ||
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      r.designation?.toLowerCase().includes(search.toLowerCase()) ||
      r.deptName?.toLowerCase().includes(search.toLowerCase());
    return matchDept && matchSearch;
  });

  return (
    <AppShell
      title="Teachers"
      subtitle={role === "hod" ? "Staff in your department" : "All college staff"}
    >
      <div className={`grid gap-6 transition-all ${selected ? "lg:grid-cols-[1fr_380px]" : "grid-cols-1"}`}>
        {/* Staff list */}
        <SectionCard title={`${filtered.length} of ${rows.length} staff member(s)`}>

          {/* Filter bar — principal/admin only */}
          {role !== "hod" && (
            <div className="flex flex-wrap gap-3 mb-4">
              <Input
                placeholder="Search by name, designation…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedId(null); }}
                className="h-9 text-sm flex-1 min-w-40"
              />
              <Select value={deptFilter} onValueChange={(v) => { setDeptFilter(v); setSelectedId(null); }}>
                <SelectTrigger className="h-9 text-sm w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {filtered.length === 0 ? (
            <Empty>{rows.length === 0 ? "No staff found." : "No staff match the current filter."}</Empty>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-semibold">Name</th>
                      <th className="pb-2 font-semibold">Designation</th>
                      <th className="pb-2 font-semibold">Department</th>
                      <th className="pb-2 font-semibold">Experience</th>
                      <th className="pb-2 font-semibold">Leaves taken</th>
                      <th className="pb-2 font-semibold">Pay-cut days</th>
                      <th className="pb-2 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-border cursor-pointer transition-colors hover:bg-muted/40 ${selectedId === r.id ? "bg-primary/5" : ""}`}
                        onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                      >
                        <td className="py-3 font-medium">{r.full_name}</td>
                        <td className="py-3 capitalize text-muted-foreground">{r.designation}</td>
                        <td className="py-3">{r.deptName}</td>
                        <td className="py-3 text-muted-foreground">
                          {r.experience_years != null ? `${r.experience_years} yr` : "—"}
                        </td>
                        <td className="py-3">{r.taken}</td>
                        <td className="py-3">
                          {r.unpaid > 0 ? (
                            <Badge variant="destructive">{r.unpaid}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-3">
                          <ChevronRight className={`size-4 text-muted-foreground transition-transform ${selectedId === r.id ? "rotate-90 text-primary" : ""}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="sm:hidden space-y-2">
                {filtered.map((r) => (
                  <li
                    key={r.id}
                    className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${selectedId === r.id ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"}`}
                    onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{r.full_name}</p>
                      <ChevronRight className={`size-4 text-muted-foreground transition-transform ${selectedId === r.id ? "rotate-90 text-primary" : ""}`} />
                    </div>
                    <p className="text-muted-foreground capitalize mt-0.5">{r.designation} · {r.deptName}</p>
                    <div className="flex gap-4 pt-1 text-xs">
                      <span>Leaves: <strong>{r.taken}</strong></span>
                      {r.experience_years != null && <span className="text-muted-foreground">{r.experience_years} yr exp</span>}
                      {r.unpaid > 0
                        ? <Badge variant="destructive" className="text-xs">{r.unpaid} pay-cut</Badge>
                        : <span className="text-muted-foreground">No pay cuts</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        {/* Detail panel */}
        {selected && (
          <TeacherDetailPanel
            teacher={selected}
            onClose={() => setSelectedId(null)}
            isHod={role === "hod"}
          />
        )}
      </div>
    </AppShell>
  );
}

// ── Teacher Detail Panel ──────────────────────────────────────────────────────
function TeacherDetailPanel({
  teacher,
  onClose,
  isHod,
}: {
  teacher: any;
  onClose: () => void;
  isHod: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expYears, setExpYears] = useState<string>(teacher.experience_years != null ? String(teacher.experience_years) : "");
  const [doj, setDoj] = useState<string>(teacher.date_of_joining ?? "");
  const [gender, setGender] = useState<string>((teacher as any).gender ?? "");
  const [subjects, setSubjects] = useState<string>(teacher.subjects_taught ?? "");
  const [saving, setSaving] = useState(false);

  // DOB: stored as "DD-MM" or "DD-MM-YYYY"; split into 3 fields
  function parseDob(raw: string | null | undefined): { day: string; month: string; year: string } {
    if (!raw) return { day: "", month: "", year: "" };
    const parts = raw.split("-");
    if (parts.length === 2) return { day: parts[0], month: parts[1], year: "" };
    if (parts.length === 3) return { day: parts[0], month: parts[1], year: parts[2] };
    return { day: "", month: "", year: "" };
  }
  const initDob = parseDob((teacher as any).date_of_birth);
  const [dobDay,   setDobDay]   = useState<string>(initDob.day);
  const [dobMonth, setDobMonth] = useState<string>(initDob.month);
  const [dobYear,  setDobYear]  = useState<string>(initDob.year);

  /** Combine the 3 parts into the stored string, or null if day+month blank */
  function buildDobValue(): string | null {
    const d = dobDay.trim().padStart(2, "0");
    const m = dobMonth.trim().padStart(2, "0");
    const y = dobYear.trim();
    if (!dobDay.trim() || !dobMonth.trim()) return null;
    return y ? `${d}-${m}-${y}` : `${d}-${m}`;
  }

  async function saveDetails() {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        experience_years: expYears ? parseInt(expYears, 10) : null,
        date_of_joining: doj || null,
        date_of_birth: buildDobValue(),
        gender: gender || null,
        subjects_taught: subjects.trim() || null,
      })
      .eq("id", teacher.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Details updated");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["staff"] });
  }

  // Fetch this teacher's lectures
  const { data: lectures = [] } = useQuery({
    queryKey: ["teacher-lectures", teacher.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("id, day_of_week, start_time, end_time, subject, class_name")
        .eq("teacher_id", teacher.id)
        .is("lecture_date", null)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return data ?? [];
    },
  });

  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDay: Record<number, typeof lectures> = {};
  for (const l of lectures) {
    if (!byDay[l.day_of_week]) byDay[l.day_of_week] = [];
    byDay[l.day_of_week].push(l);
  }

  function fmtTime(t: string) {
    const [h, m] = t.split(":").map(Number);
    const s = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${s}`;
  }

  const subjectList = teacher.subjects_taught
    ? teacher.subjects_taught.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg">
            {teacher.full_name.charAt(0)}
          </div>
          <div>
            <p className="font-bold text-base">{teacher.full_name}</p>
            <p className="text-sm text-muted-foreground capitalize">{teacher.designation}</p>
            <p className="text-xs text-muted-foreground">{teacher.deptName}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {isHod && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setEditing((v) => !v)}
              title="Edit teacher details"
            >
              <Edit3 className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-5 max-h-[calc(100vh-220px)] overflow-y-auto">

        {/* Key stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Leaves this yr", value: teacher.taken, icon: Calendar, color: "text-warning-foreground" },
            { label: "Pay-cut days", value: teacher.unpaid, icon: TrendingUp, color: teacher.unpaid > 0 ? "text-destructive" : "text-muted-foreground" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
              <Icon className={`size-4 mb-1 ${color}`} />
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Profile details — editable if HOD */}
        {editing ? (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit details</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Date of joining</Label>
              <Input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date of Birth <span className="text-muted-foreground font-normal">(Year optional)</span></Label>
              <div className="grid grid-cols-3 gap-2">
                {/* Day */}
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Day</p>
                  <select
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={dobDay}
                    onChange={(e) => setDobDay(e.target.value)}
                  >
                    <option value="">—</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d).padStart(2, "0")}>
                        {String(d).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Month */}
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Month</p>
                  <select
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={dobMonth}
                    onChange={(e) => setDobMonth(e.target.value)}
                  >
                    <option value="">—</option>
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map((mn, i) => (
                      <option key={mn} value={String(i + 1).padStart(2, "0")}>{mn}</option>
                    ))}
                  </select>
                </div>
                {/* Year — optional */}
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Year <span className="italic">(optional)</span></p>
                  <Input
                    type="number"
                    min={1900}
                    max={new Date().getFullYear()}
                    placeholder="YYYY"
                    value={dobYear}
                    onChange={(e) => setDobYear(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              {/* Live preview */}
              {(dobDay || dobMonth) && (
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  Preview:{" "}
                  <span className="font-medium text-foreground">
                    {dobDay && dobMonth
                      ? `${dobDay} ${["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(dobMonth,10)-1]}${dobYear ? ` ${dobYear}` : ""}`
                      : "—"}
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gender</Label>
              <select
                className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other / Prefer not to say</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Experience (years)</Label>
              <Input type="number" min={0} max={50} value={expYears} onChange={(e) => setExpYears(e.target.value)} className="h-8 text-sm" placeholder="e.g. 8" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Subjects taught (comma-separated)</Label>
              <Textarea
                rows={2}
                value={subjects}
                onChange={(e) => setSubjects(e.target.value)}
                className="text-sm resize-none"
                placeholder="e.g. Data Structures, DBMS, OS"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveDetails} disabled={saving} className="gap-1.5">
                <Check className="size-3.5" /> {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Date of joining */}
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Calendar className="size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Date of joining</p>
                <p className="text-sm font-medium">{teacher.date_of_joining ? fmtDate(teacher.date_of_joining) : "Not set"}</p>
              </div>
            </div>
            {/* Date of Birth — visible to HOD and Principal only */}
            <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-muted/20">
              <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Date of Birth</p>
                <p className="text-sm font-medium">
                  {(() => {
                    const raw: string | undefined = (teacher as any).date_of_birth;
                    if (!raw) return "Not set";
                    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
                    const parts = raw.split("-");
                    if (parts.length >= 2) {
                      const day   = parts[0];
                      const month = MONTHS[parseInt(parts[1], 10) - 1] ?? parts[1];
                      const year  = parts[2] ?? null;
                      return year ? `${day} ${month} ${year}` : `${day} ${month}`;
                    }
                    return raw;
                  })()}
                </p>
              </div>
            </div>
            {/* Gender */}
            <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-muted/20">
              <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Gender</p>
                <p className="text-sm font-medium capitalize">{(teacher as any).gender ?? "Not set"}</p>
              </div>
            </div>
            {/* Experience */}
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Experience</p>
                <p className="text-sm font-medium">{teacher.experience_years != null ? `${teacher.experience_years} year${teacher.experience_years !== 1 ? "s" : ""}` : "Not set"}</p>
              </div>
            </div>
            {/* Subjects */}
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <BookOpen className="size-4 shrink-0 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Subjects taught</p>
                {subjectList.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {subjectList.map((s: string) => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-muted-foreground">Not set</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Timetable */}
        {lectures.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Weekly timetable</p>
            <div className="space-y-2">
              {Object.entries(byDay)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([dow, lecs]) => (
                  <div key={dow}>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">{DAY_SHORT[Number(dow)]}</p>
                    <div className="space-y-1">
                      {lecs.map((l) => (
                        <div key={l.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                          <Clock className="size-3 text-muted-foreground shrink-0" />
                          <span className="font-medium">{l.subject}</span>
                          <span className="text-muted-foreground">{l.class_name}</span>
                          <span className="ml-auto text-muted-foreground">{fmtTime(l.start_time)}–{fmtTime(l.end_time)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Leave history */}
        {teacher.leaveHistory.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Leave history this year</p>
            <ul className="space-y-1.5">
              {teacher.leaveHistory.slice(0, 6).map((l: any, i: number) => (
                <li key={i} className="flex items-center gap-2 text-xs rounded-lg border border-border px-3 py-2">
                  <span className="font-medium text-muted-foreground">{leaveTypeLabel(l.leave_type as LeaveType)}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{fmtDate(l.from_date)} – {fmtDate(l.to_date)}</span>
                  <span className="ml-auto font-medium">{Number(l.total_days)} day{Number(l.total_days) !== 1 ? "s" : ""}</span>
                </li>
              ))}
              {teacher.leaveHistory.length > 6 && (
                <p className="text-xs text-muted-foreground text-center pt-1">+{teacher.leaveHistory.length - 6} more</p>
              )}
            </ul>
          </div>
        )}

        {teacher.leaveHistory.length === 0 && lectures.length === 0 && !editing && (
          <div className="rounded-xl border border-dashed border-border py-6 text-center">
            <GraduationCap className="mx-auto size-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">No leaves or timetable data yet.</p>
            {isHod && <p className="text-xs text-muted-foreground mt-1">Click <Edit3 className="inline size-3" /> to fill in details.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
