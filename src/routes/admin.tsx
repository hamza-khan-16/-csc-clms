import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, Check, FileText, Download, BarChart2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateStaff, adminDeleteStaff } from "@/lib/admin.functions";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, Empty } from "@/components/ui-bits";
import { money, LEAVE_TYPES, fmtDate, type LeaveType } from "@/lib/leave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Panel — CSC Leave Management" },
      {
        name: "description",
        content:
          "Approve staff registrations, create teachers, HODs and the principal, edit salaries and oversee the whole college.",
      },
      { property: "og:title", content: "Admin Panel — CSC Leave Management" },
      {
        property: "og:description",
        content: "Full administrative control of staff, roles, salaries and departments.",
      },
    ],
  }),
  component: () => (
    <Guarded roles={["admin"]}>
      <AdminPage />
    </Guarded>
  ),
});

type ProfilePatch = {
  approved?: boolean;
  designation?: string;
  department_id?: string | null;
  monthly_salary?: number;
};

type StaffRow = {
  id: string;
  full_name: string;
  user_id: string;
  designation: string;
  department_id: string | null;
  monthly_salary: number;
  approved: boolean;
  role: "teacher" | "hod" | "principal" | "admin" | null;
  deptName: string;
};

function AdminPage() {
  const qc = useQueryClient();

  const { data: departments = [] } = useQuery({
    queryKey: ["admin-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: staff = [], isLoading } = useQuery<StaffRow[]>({
    queryKey: ["admin-staff"],
    queryFn: async () => {
      const [{ data: profiles, error }, { data: roles }, { data: depts }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, user_id, designation, department_id, monthly_salary, approved")
          .order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("departments").select("id, name"),
      ]);
      if (error) throw error;
      return (profiles ?? []).map((p) => ({
        ...p,
        monthly_salary: Number(p.monthly_salary ?? 0),
        role: ((roles ?? []).find((r) => r.user_id === p.id)?.role ?? null) as StaffRow["role"],
        deptName: (depts ?? []).find((d) => d.id === p.department_id)?.name ?? "—",
      }));
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const year = new Date().getFullYear();
      const [{ count: leaves }, { count: pendingLeaves }, { data: unpaid }] = await Promise.all([
        supabase.from("leave_requests").select("id", { count: "exact", head: true }),
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending_hod", "hod_recommended", "pending_principal"]),
        supabase
          .from("leave_requests")
          .select("unpaid_days")
          .eq("status", "approved")
          .gte("from_date", `${year}-01-01`),
      ]);
      return {
        leaves: leaves ?? 0,
        pendingLeaves: pendingLeaves ?? 0,
        unpaidDays: (unpaid ?? []).reduce((s, l) => s + Number(l.unpaid_days), 0),
      };
    },
  });

  const pending = staff.filter((s) => !s.approved);
  const payroll = staff.filter((s) => s.role !== "admin").reduce((s, r) => s + r.monthly_salary, 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-staff"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const patch = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ProfilePatch }) => {
      const { data, error } = await supabase
        .from("profiles")
        .update(values)
        .eq("id", id)
        .select("user_id")
        .single();
      if (error) throw error;
      return { collegeId: data?.user_id as string | undefined, approved: values.approved };
    },
    onSuccess: (result) => {
      invalidate();
      if (result?.approved && result.collegeId) {
        toast.success(`Approved — college ID ${result.collegeId}`);
      } else {
        toast.success("Saved");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const changeRole = useMutation({
    mutationFn: async ({ id, role, departmentId }: { id: string; role: StaffRow["role"]; departmentId: string | null }) => {
      if (!role) return;
      // Enforce single-admin and single-principal constraints
      if (role === "admin" || role === "principal") {
        const { data: existing } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", role)
          .neq("user_id", id);
        if (existing && existing.length > 0) {
          throw new Error(
            role === "admin"
              ? "There is already an administrator. Only one admin is allowed."
              : "There is already a principal. Only one principal is allowed.",
          );
        }
      }
      const { error: delError } = await supabase.from("user_roles").delete().eq("user_id", id);
      if (delError) throw delError;
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: id, role, department_id: role === "principal" || role === "admin" ? null : departmentId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Role updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteFn = useServerFn(adminDeleteStaff);
  const removeStaff = useMutation({
    mutationFn: async (staffId: string) => deleteFn({ data: { staffId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Staff member removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Admin Panel" subtitle="Full oversight of staff, roles, salaries and leave">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Staff accounts" value={staff.length} />
          <StatCard
            label="Pending approvals"
            value={pending.length}
            tone={pending.length ? "warning" : "default"}
          />
          <StatCard label="Leave requests awaiting action" value={stats?.pendingLeaves ?? 0} />
          <StatCard label="Monthly payroll" value={money(payroll)} hint={`${stats?.unpaidDays ?? 0} unpaid days this year`} />
        </div>

        <SectionCard
          title="Pending registrations"
          subtitle="New teachers cannot use the system until you approve them"
        >
          {pending.length === 0 ? (
            <Empty>No registrations waiting for approval.</Empty>
          ) : (
            <ul className="space-y-3">
              {pending.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{p.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.user_id} · {p.designation} · {p.deptName}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => patch.mutate({ id: p.id, values: { approved: true } })}
                    >
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => removeStaff.mutate(p.id)}
                      disabled={removeStaff.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <AddStaffCard departments={departments} onDone={invalidate} />

        <SectionCard title="All staff" subtitle="Edit salary, role, department or remove an account">
          {isLoading ? (
            <Empty>Loading…</Empty>
          ) : staff.length === 0 ? (
            <Empty>No staff yet.</Empty>
          ) : (
            <div className="space-y-3">
              {staff.map((s) => (
                <StaffRowCard
                  key={s.id}
                  row={s}
                  departments={departments}
                  onSaveProfile={(values) => patch.mutate({ id: s.id, values })}
                  onChangeRole={(role, departmentId) =>
                    changeRole.mutate({ id: s.id, role, departmentId })
                  }
                  onRemove={() => removeStaff.mutate(s.id)}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <ExportsCard />

        <DepartmentsCard departments={departments} />
      </div>
    </AppShell>
  );
}

function StaffRowCard({
  row,
  departments,
  onSaveProfile,
  onChangeRole,
  onRemove,
}: {
  row: StaffRow;
  departments: { id: string; name: string }[];
  onSaveProfile: (values: ProfilePatch) => void;
  onChangeRole: (role: StaffRow["role"], departmentId: string | null) => void;
  onRemove: () => void;
}) {
  const [salary, setSalary] = useState(String(row.monthly_salary));
  const [designation, setDesignation] = useState(row.designation);
  const [dept, setDept] = useState(row.department_id ?? "none");
  const [role, setRole] = useState<StaffRow["role"]>(row.role);

  const departmentId = dept === "none" ? null : dept;
  const dirtyProfile =
    Number(salary) !== row.monthly_salary ||
    designation !== row.designation ||
    departmentId !== row.department_id;
  const dirtyRole = role !== row.role;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.user_id}</p>
        </div>
        <div className="flex items-center gap-2">
          {row.approved ? (
            <Badge variant="secondary">Approved</Badge>
          ) : (
            <Badge variant="destructive">Pending</Badge>
          )}
          <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Remove staff member">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {row.role !== "principal" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Monthly salary</Label>
          <Input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} />
        </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Designation</Label>
          <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Department</Label>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No department</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Role</Label>
          <Select value={role ?? "teacher"} onValueChange={(v) => setRole(v as StaffRow["role"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="hod">HOD</SelectItem>
              <SelectItem value="principal">Principal</SelectItem>
              <SelectItem value="admin">Administrator</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!dirtyProfile}
          onClick={() =>
            onSaveProfile({
              monthly_salary: Number(salary) || 0,
              designation,
              department_id: departmentId,
            })
          }
        >
          Save details
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirtyRole}
          onClick={() => onChangeRole(role, departmentId)}
        >
          Update role
        </Button>
        {!row.approved && (
          <Button size="sm" variant="secondary" onClick={() => onSaveProfile({ approved: true })}>
            Approve
          </Button>
        )}
      </div>
    </div>
  );
}

function AddStaffCard({
  departments,
  onDone,
}: {
  departments: { id: string; name: string }[];
  onDone: () => void;
}) {
  const createFn = useServerFn(adminCreateStaff);
  const [form, setForm] = useState({
    email: "",
    password: "",
    fullName: "",
    designation: "Assistant Professor",
    departmentId: "",
    role: "teacher" as "teacher" | "hod" | "principal",
    monthlySalary: "60000",
  });

  const create = useMutation({
    mutationFn: async () =>
      createFn({
        data: {
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          designation: form.designation,
          departmentId: form.role === "principal" ? null : form.departmentId || null,
          role: form.role,
          monthlySalary: Number(form.monthlySalary) || 0,
        },
      }),
    onSuccess: () => {
      toast.success("Staff account created");
      setForm({ ...form, email: "", password: "", fullName: "" });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SectionCard
      title="Add staff"
      subtitle="Teachers, HODs and the principal can only be created here"
    >
      <form
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <Input
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>User ID (email)</Label>
          <Input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Temporary password</Label>
          <Input
            required
            minLength={8}
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select
            value={form.role}
            onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="hod">HOD</SelectItem>
              <SelectItem value="principal">Principal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Department</Label>
          <Select
            value={form.departmentId}
            disabled={form.role === "principal"}
            onValueChange={(v) => setForm({ ...form, departmentId: v })}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={form.role === "principal" ? "Not applicable" : "Select department"}
              />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Designation</Label>
          <Input
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
          />
        </div>
        {form.role !== "principal" && (
        <div className="space-y-1.5">
          <Label>Monthly salary</Label>
          <Input
            type="number"
            min={0}
            value={form.monthlySalary}
            onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })}
          />
        </div>
        )}
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Create account
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

// ─── Analytics & Exports ─────────────────────────────────────────────────────

const REPORT_MODULES = [
  {
    key: "teacher",
    label: "Teacher Report",
    description: "Faculty attendance & subject allocation",
    filter: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher: people[l.teacher_id]?.full_name ?? "—",
        Department: people[l.teacher_id]?.department_name ?? "—",
        "Leave Type": l.leave_type,
        "From Date": l.from_date,
        "To Date": l.to_date,
        "Total Days": l.total_days,
        "Paid Days": l.paid_days,
        "Pay Cut Days": l.unpaid_days,
        Status: l.status,
      })),
  },
  {
    key: "department",
    label: "Department Report",
    description: "Department-level metrics and leaves",
    filter: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, { total: number; unpaid: number; count: number }> = {};
      for (const l of leaves) {
        const dept = people[l.teacher_id]?.department_name ?? "Unknown";
        if (!map[dept]) map[dept] = { total: 0, unpaid: 0, count: 0 };
        map[dept].total += Number(l.total_days);
        map[dept].unpaid += Number(l.unpaid_days);
        map[dept].count += 1;
      }
      return Object.entries(map).map(([dept, v]) => ({
        Department: dept,
        "Leave Requests": v.count,
        "Total Days": v.total,
        "Pay Cut Days": v.unpaid,
      }));
    },
  },
  {
    key: "history",
    label: "Leave History Report",
    description: "Audit trail of all leave requests",
    filter: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher: people[l.teacher_id]?.full_name ?? "—",
        "Leave Type": l.leave_type,
        "From Date": l.from_date,
        "To Date": l.to_date,
        Session: l.session,
        "Total Days": l.total_days,
        "Paid Days": l.paid_days,
        "Pay Cut Days": l.unpaid_days,
        Status: l.status,
        Reason: l.reason,
      })),
  },
  {
    key: "attendance",
    label: "Attendance Report",
    description: "Monthly attendance percentages",
    filter: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, Record<string, number>> = {};
      for (const l of leaves) {
        const name = people[l.teacher_id]?.full_name ?? "—";
        const month = l.from_date.slice(0, 7);
        if (!map[name]) map[name] = {};
        map[name][month] = (map[name][month] ?? 0) + Number(l.total_days);
      }
      return Object.entries(map).flatMap(([name, months]) =>
        Object.entries(months).map(([month, days]) => ({
          Teacher: name,
          Month: month,
          "Leave Days": days,
          "Working Days (approx)": 26,
          "Attendance %": (((26 - days) / 26) * 100).toFixed(1) + "%",
        })),
      );
    },
  },
  {
    key: "payroll",
    label: "Payroll Report",
    description: "Salary impact based on unexcused leaves",
    filter: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves
        .filter((l) => Number(l.unpaid_days) > 0)
        .map((l) => ({
          Teacher: people[l.teacher_id]?.full_name ?? "—",
          Department: people[l.teacher_id]?.department_name ?? "—",
          "Leave Type": l.leave_type,
          "From Date": l.from_date,
          "To Date": l.to_date,
          "Pay Cut Days": l.unpaid_days,
          Status: l.status,
        })),
  },
] as const;

type ReportLeave = {
  id: string;
  teacher_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  session: string;
  total_days: number;
  paid_days: number;
  unpaid_days: number;
  status: string;
  reason: string;
};

type PeopleMap = Record<string, { full_name: string; department_name: string | null } | undefined>;

function ExportsCard() {
  const year = new Date().getFullYear();
  const [activeModule, setActiveModule] = useState<string>("teacher");
  const [exporting, setExporting] = useState(false);

  const { data: reportData } = useQuery({
    queryKey: ["admin-report-data", year],
    queryFn: async () => {
      const { data: leaves, error } = await supabase
        .from("leave_requests")
        .select("id, teacher_id, leave_type, from_date, to_date, session, total_days, paid_days, unpaid_days, status, reason")
        .gte("from_date", `${year}-01-01`)
        .lte("from_date", `${year}-12-31`)
        .order("from_date");
      if (error) throw error;

      // Fetch people
      const ids = [...new Set((leaves ?? []).map((l) => l.teacher_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, department_id, departments(name)")
        .in("id", ids);

      const people: PeopleMap = {};
      for (const p of profiles ?? []) {
        people[p.id] = {
          full_name: p.full_name,
          department_name: (p.departments as { name: string } | null)?.name ?? null,
        };
      }
      return { leaves: (leaves ?? []) as ReportLeave[], people };
    },
  });

  const leaves = reportData?.leaves ?? [];
  const people = reportData?.people ?? {};

  // Leave type bar chart data
  const byType = LEAVE_TYPES.map((t) => ({
    ...t,
    count: leaves.filter((l) => l.leave_type === t.value && l.status === "approved").reduce((s, l) => s + Number(l.total_days), 0),
  }));
  const maxCount = Math.max(1, ...byType.map((t) => t.count));

  function getRows() {
    const mod = REPORT_MODULES.find((m) => m.key === activeModule);
    if (!mod) return [];
    return mod.filter(leaves, people) as Record<string, unknown>[];
  }

  function exportCSV() {
    const rows = getRows();
    if (rows.length === 0) return toast.error("No data to export");
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeModule}-report-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }

  async function exportPDF() {
    setExporting(true);
    try {
      const rows = getRows();
      if (rows.length === 0) { toast.error("No data to export"); return; }
      const mod = REPORT_MODULES.find((m) => m.key === activeModule)!;
      const headers = Object.keys(rows[0]);

      // Build a printable HTML table and open in new window
      const tableRows = rows
        .map(
          (r) =>
            `<tr>${headers.map((h) => `<td style="border:1px solid #ddd;padding:6px 10px;font-size:12px">${r[h] ?? ""}</td>`).join("")}</tr>`,
        )
        .join("");
      const html = `
        <html><head><title>${mod.label} — ${year}</title>
        <style>body{font-family:sans-serif;margin:24px}h1{font-size:18px;margin-bottom:4px}p{color:#666;font-size:13px;margin-bottom:16px}table{border-collapse:collapse;width:100%}th{background:#4f46e5;color:#fff;padding:7px 10px;font-size:12px;text-align:left}tr:nth-child(even){background:#f5f5f5}@media print{button{display:none}}</style>
        </head><body>
        <h1>${mod.label}</h1><p>${mod.description} · ${year}</p>
        <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${tableRows}</tbody></table>
        <br/><button onclick="window.print()">Print / Save as PDF</button>
        </body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } finally {
      setExporting(false);
    }
  }

  return (
    <SectionCard
      title="Analytics & Exports"
      subtitle={`Leave data for ${year}`}
    >
      {/* Leave type breakdown */}
      <div className="mb-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Approved leave days by type
        </p>
        <ul className="space-y-2.5">
          {byType.map((t) => (
            <li key={t.value}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-foreground">{t.label}</span>
                <span className="font-bold text-primary">{t.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${(t.count / maxCount) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Report module selector */}
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Report modules
      </p>
      <ul className="mb-5 divide-y divide-border rounded-xl border border-border overflow-hidden">
        {REPORT_MODULES.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              onClick={() => setActiveModule(m.key)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${activeModule === m.key ? "bg-primary/8" : ""}`}
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${activeModule === m.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                <FileText className="size-4" />
              </span>
              <span className="flex-1">
                <span className={`block text-sm font-semibold ${activeModule === m.key ? "text-primary" : ""}`}>{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.description}</span>
              </span>
              <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${activeModule === m.key ? "rotate-90 text-primary" : ""}`} />
            </button>
          </li>
        ))}
      </ul>

      {/* Export buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 gap-2"
          onClick={exportPDF}
          disabled={exporting}
        >
          <Download className="size-4" />
          Export PDF
        </Button>
        <Button
          className="flex-1 gap-2"
          onClick={exportCSV}
        >
          <BarChart2 className="size-4" />
          Export Excel (CSV)
        </Button>
      </div>

      {/* Row preview count */}
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {getRows().length} row(s) in the selected report · export downloads all rows
      </p>
    </SectionCard>
  );
}

function DepartmentsCard({ departments }: { departments: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("departments").insert({ name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["admin-departments"] });
      toast.success("Department added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-departments"] });
      toast.success("Department removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SectionCard title="Departments" subtitle="Add or remove departments">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input
          placeholder="New department name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      {departments.length === 0 ? (
        <Empty>No departments configured.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <span>{d.name}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove.mutate(d.id)}
                aria-label={`Remove ${d.name}`}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
