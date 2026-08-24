import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, Check, FileText, Download, BarChart2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminCreateStaff, adminDeleteStaff, directPasswordReset, unlockAccount, fetchPasswordResetRequests, completePasswordResetRequest } from "@/lib/admin.functions";
import { sendPushNotification } from "@/lib/push.functions";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, Empty } from "@/components/ui-bits";
import { money, LEAVE_TYPES, leaveTypeLabel, fmtDate, type LeaveType } from "@/lib/leave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  cl_quota?: number | null;
};

type StaffRow = {
  id: string;
  full_name: string;
  user_id: string;
  designation: string;
  department_id: string | null;
  monthly_salary: number;
  cl_quota: number | null;
  approved: boolean;
  account_locked: boolean;
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
          .select("id, full_name, user_id, designation, department_id, monthly_salary, cl_quota, approved, account_locked")
          .order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("departments").select("id, name"),
      ]);
      if (error) throw error;
      return (profiles ?? []).map((p) => ({
        ...p,
        monthly_salary: Number(p.monthly_salary ?? 0),
        cl_quota: (p as any).cl_quota != null ? Number((p as any).cl_quota) : null,
        account_locked: Boolean((p as any).account_locked),
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

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const pending = staff.filter((s) => !s.approved);
  const payroll = staff.filter((s) => s.role !== "admin").reduce((s, r) => s + r.monthly_salary, 0);
  const sendPush = useServerFn(sendPushNotification);

  // Approval dialog state
  const [approvalDialog, setApprovalDialog] = useState<{ id: string; name: string; currentSalary: number } | null>(null);
  const [approvalSalary, setApprovalSalary] = useState("");
  const [approvalClQuota, setApprovalClQuota] = useState("12");

  function openApprovalDialog(p: StaffRow) {
    setApprovalSalary(p.monthly_salary > 0 ? String(p.monthly_salary) : "");
    setApprovalClQuota("12");
    setApprovalDialog({ id: p.id, name: p.full_name, currentSalary: p.monthly_salary });
  }

  async function confirmApproval() {
    if (!approvalDialog) return;
    const salary = Number(approvalSalary);
    const clQuota = Number(approvalClQuota);
    if (!approvalSalary || isNaN(salary) || salary <= 0) return toast.error("Enter a valid monthly salary");
    if (isNaN(clQuota) || clQuota < 0 || clQuota > 365) return toast.error("Casual leave quota must be between 0 and 365");
    // Don't close dialog until patch succeeds — let onSuccess close it
    patch.mutate({ id: approvalDialog.id, values: { approved: true, monthly_salary: salary, cl_quota: clQuota } });
  }

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
    onSuccess: (result, { id }) => {
      invalidate();
      setApprovalDialog(null);
      if (result?.approved && result.collegeId) {
        toast.success(`Approved — college ID ${result.collegeId}`);
        sendPush({ data: {
          userIds: [id],
          title: "Account Approved ✓",
          body: `Your registration has been approved. Your college ID is ${result.collegeId}`,
          targetUrl: "/dashboard",
        }}).catch((e) => console.error("[Push] teacher approved:", e));
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
                      onClick={() => openApprovalDialog(p)}
                    >
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteConfirm({ id: p.id, name: p.full_name })}
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

        {/* Approval dialog */}
        <Dialog open={!!approvalDialog} onOpenChange={(v) => !v && setApprovalDialog(null)}>
          <DialogContent className="w-[calc(100vw-32px)] max-w-md">
            <DialogHeader>
              <DialogTitle>Approve {approvalDialog?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="approval-salary">Monthly Salary (₹)</Label>
                <Input
                  id="approval-salary"
                  type="number"
                  min={0}
                  placeholder="e.g. 45000"
                  value={approvalSalary}
                  onChange={(e) => setApprovalSalary(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="approval-cl">Casual Leave Quota (days/year)</Label>
                <Input
                  id="approval-cl"
                  type="number"
                  min={0}
                  max={365}
                  placeholder="Default: 12"
                  value={approvalClQuota}
                  onChange={(e) => setApprovalClQuota(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Default is 12 days/year. This overrides the standard quota for this teacher.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApprovalDialog(null)}>Cancel</Button>
              <Button onClick={confirmApproval}>
                <Check className="size-4 mr-1" /> Confirm Approval
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation dialog */}
        <AlertDialog open={!!deleteConfirm} onOpenChange={(v) => !v && setDeleteConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove <strong>{deleteConfirm?.name}</strong> and all their data. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { if (deleteConfirm) { removeStaff.mutate(deleteConfirm.id); setDeleteConfirm(null); } }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AddStaffCard departments={departments} onDone={invalidate} />

        <PasswordResetRequests />

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
                  onRemove={() => setDeleteConfirm({ id: s.id, name: s.full_name })}
                  onInvalidate={invalidate}
                />
              ))}
            </div>
          )}
        </SectionCard>

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
  onInvalidate,
}: {
  row: StaffRow;
  departments: { id: string; name: string }[];
  onSaveProfile: (values: ProfilePatch) => void;
  onChangeRole: (role: StaffRow["role"], departmentId: string | null) => void;
  onRemove: () => void;
  onInvalidate: () => void;
}) {
  const [salary, setSalary] = useState(String(row.monthly_salary));
  const [designation, setDesignation] = useState(row.designation);
  const [dept, setDept] = useState(row.department_id ?? "none");
  const [role, setRole] = useState<StaffRow["role"]>(row.role);
  const [clQuota, setClQuota] = useState<string>(row.cl_quota != null ? String(row.cl_quota) : "12");
  const [resetPw, setResetPw] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const resetFn = useServerFn(directPasswordReset);
  const unlockFn = useServerFn(unlockAccount);

  async function handleDirectReset() {
    if (resetPw.length < 12) return toast.error("New password must be at least 12 characters");
    setResetBusy(true);
    try {
      await resetFn({ data: { targetUserId: row.id, newPassword: resetPw } });
      toast.success("Password reset successfully");
      setResetPw("");
      onInvalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleUnlock() {
    try {
      await unlockFn({ data: { targetUserId: row.id } });
      toast.success("Account unlocked");
      onInvalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unlock failed");
    }
  }

  const departmentId = dept === "none" ? null : dept;
  const originalClQuota = row.cl_quota != null ? String(row.cl_quota) : "12";
  const dirtyProfile =
    Number(salary) !== row.monthly_salary ||
    designation !== row.designation ||
    departmentId !== row.department_id ||
    clQuota !== originalClQuota;
  const dirtyRole = role !== row.role;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.user_id}</p>
        </div>
        <div className="flex items-center gap-2">
          {row.account_locked && (
            <Badge variant="destructive">Locked</Badge>
          )}
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
          <Label className="text-xs">Casual leave quota (days/yr)</Label>
          <Input
            type="number"
            min={0}
            max={365}
            placeholder="12"
            value={clQuota}
            onChange={(e) => setClQuota(e.target.value)}
            title="Override the default 12-day annual casual leave quota for this teacher"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Designation</Label>
          <Select value={designation} onValueChange={setDesignation}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["Assistant Professor","Associate Professor","Professor","Senior Professor","Head of Department","Principal","Vice Principal","Lecturer","Senior Lecturer","Lab Assistant","Teaching Assistant"].map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          onClick={async () => {
            const quota = Number(clQuota);
            onSaveProfile({
              monthly_salary: Number(salary) || 0,
              designation,
              department_id: departmentId,
              cl_quota: !isNaN(quota) && quota >= 0 ? quota : null,
            });

          }}
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
        {row.account_locked && row.role !== "admin" && (
          <Button size="sm" variant="outline" onClick={handleUnlock}>
            Unlock account
          </Button>
        )}
      </div>

      {/* Direct password reset — admin only, not for other admins */}
      {row.role !== "admin" && (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Reset password (min 12 chars)</Label>
            <Input
              type="password"
              placeholder="New password…"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={resetBusy || resetPw.length < 12}
            onClick={handleDirectReset}
          >
            {resetBusy ? "Resetting…" : "Reset"}
          </Button>
        </div>
      )}
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
    gender: "" as "female" | "male" | "other" | "",
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
          gender: (form.gender as "female" | "male" | "other") || null,
        },
      }),
    onSuccess: () => {
      toast.success("Staff account created");
      setForm({ ...form, email: "", password: "", fullName: "", gender: "" });
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
          <Select value={form.designation} onValueChange={(v) => setForm({ ...form, designation: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["Assistant Professor","Associate Professor","Professor","Senior Professor","Head of Department","Principal","Vice Principal","Lecturer","Senior Lecturer","Lab Assistant","Teaching Assistant"].map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v as typeof form.gender })}>
            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="other">Other / Prefer not to say</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">Required to enable maternity leave for eligible staff.</p>
        </div>
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

const perDay = (monthly: number) => monthly / 30;
const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));

const REPORT_MODULES = [
  {
    key: "teacher",
    label: "Teacher Report",
    description: "All leave records per teacher",
    filter: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher:        people[l.teacher_id]?.full_name ?? "—",
        Department:     people[l.teacher_id]?.department_name ?? "—",
        "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
        From:           fmtDate(l.from_date),
        To:             fmtDate(l.to_date),
        Session:        l.session,
        "Total Days":   l.total_days,
        "Paid Days":    l.paid_days,
        "Pay Cut Days": l.unpaid_days,
        Status:         l.status.replace(/_/g, " "),
        Reason:         l.reason ?? "",
      })),
  },
  {
    key: "department",
    label: "Department Report",
    description: "Department-level leave summary",
    filter: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, { total: number; unpaid: number; count: number }> = {};
      for (const l of leaves) {
        const dept = people[l.teacher_id]?.department_name ?? "Unknown";
        if (!map[dept]) map[dept] = { total: 0, unpaid: 0, count: 0 };
        map[dept].total  += Number(l.total_days);
        map[dept].unpaid += Number(l.unpaid_days);
        map[dept].count  += 1;
      }
      return Object.entries(map).map(([dept, v]) => ({
        Department:       dept,
        "Leave Requests": v.count,
        "Total Days":     v.total,
        "Pay Cut Days":   v.unpaid,
      }));
    },
  },
  {
    key: "history",
    label: "Leave History Report",
    description: "Audit trail of all leave requests",
    filter: (leaves: ReportLeave[], people: PeopleMap) =>
      leaves.map((l) => ({
        Teacher:        people[l.teacher_id]?.full_name ?? "—",
        Department:     people[l.teacher_id]?.department_name ?? "—",
        "Leave Type":   leaveTypeLabel(l.leave_type as LeaveType),
        From:           fmtDate(l.from_date),
        To:             fmtDate(l.to_date),
        Session:        l.session,
        "Total Days":   l.total_days,
        "Paid Days":    l.paid_days,
        "Pay Cut Days": l.unpaid_days,
        Status:         l.status.replace(/_/g, " "),
        Reason:         l.reason ?? "",
      })),
  },
  {
    key: "attendance",
    label: "Attendance Report",
    description: "Monthly leave days per teacher",
    filter: (leaves: ReportLeave[], people: PeopleMap) => {
      const map: Record<string, Record<string, number>> = {};
      for (const l of leaves) {
        const name  = people[l.teacher_id]?.full_name ?? "—";
        const month = l.from_date.slice(0, 7);
        if (!map[name]) map[name] = {};
        map[name][month] = (map[name][month] ?? 0) + Number(l.total_days);
      }
      return Object.entries(map).flatMap(([name, months]) =>
        Object.entries(months).map(([month, days]) => ({
          Teacher:             name,
          Month:               month,
          "Leave Days":        days,
          "Working Days":      26,
          "Attendance %":      (((26 - days) / 26) * 100).toFixed(1) + "%",
        })),
      );
    },
  },
  {
    key: "payroll",
    label: "Payroll Report",
    description: "Salary deductions for all teaching staff",
    filter: (leaves: ReportLeave[], people: PeopleMap) => {
      const approved = leaves.filter((l) => ["approved", "hod_approved"].includes(l.status));
      return Object.entries(people)
        .filter(([, p]) => p !== undefined)
        .map(([id, p]) => {
          const myLeaves   = approved.filter((l) => l.teacher_id === id);
          const totalDays  = myLeaves.reduce((s, l) => s + Number(l.total_days),  0);
          const paidDays   = myLeaves.reduce((s, l) => s + Number(l.paid_days),   0);
          const unpaidDays = myLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0);
          const monthlySal = p!.monthly_salary ?? 0;
          const deduction  = perDay(monthlySal) * unpaidDays;
          return {
            Teacher:              p!.full_name,
            Department:           p!.department_name ?? "—",
            "Monthly Salary":     fmtINR(monthlySal),
            "Leave Days":         totalDays,
            "Paid Leave Days":    paidDays,
            "Unpaid Leave Days":  unpaidDays,
            "Deduction":          fmtINR(deduction),
            "Net Payable":        fmtINR(monthlySal - deduction),
          };
        })
        .sort((a, b) => String(a.Teacher).localeCompare(String(b.Teacher)));
    },
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

type PeopleMap = Record<string, { full_name: string; department_name: string | null; monthly_salary?: number } | undefined>;

function ExportsCard() {
  const year = new Date().getFullYear();
  const [activeModule, setActiveModule] = useState<string>("teacher");
  const [exporting, setExporting] = useState(false);

  const { data: reportData } = useQuery({
    queryKey: ["admin-report-data", year],
    queryFn: async () => {
      const [{ data: leaves, error }, { data: profiles }, { data: roles }, { data: depts }] = await Promise.all([
        supabase
          .from("leave_requests")
          .select("id, teacher_id, leave_type, from_date, to_date, session, total_days, paid_days, unpaid_days, status, reason")
          .gte("from_date", `${year}-01-01`)
          .lte("from_date", `${year}-12-31`)
          .order("from_date"),
        supabase
          .from("profiles")
          .select("id, full_name, department_id, monthly_salary, approved")
          .eq("approved", true),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("departments").select("id, name"),
      ]);
      if (error) throw error;

      const roleMap: Record<string, string> = {};
      for (const r of roles ?? []) roleMap[r.user_id] = r.role;

      const deptMap: Record<string, string> = {};
      for (const d of depts ?? []) deptMap[d.id] = d.name;

      const people: PeopleMap = {};
      for (const p of profiles ?? []) {
        const role = roleMap[p.id];
        if (role === "admin" || role === "principal") continue;
        people[p.id] = {
          full_name: p.full_name,
          department_name: p.department_id ? (deptMap[p.department_id] ?? null) : null,
          monthly_salary: Number((p as any).monthly_salary ?? 0),
        };
      }

      const staffIds = new Set(Object.keys(people));
      return {
        leaves: (leaves ?? []).filter((l) => staffIds.has(l.teacher_id)) as ReportLeave[],
        people,
      };
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

      // HTML escape to prevent XSS in print export
      const escHtml = (s: unknown) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

      // Build a printable HTML table and open in new window
      const tableRows = rows
        .map(
          (r) =>
            `<tr>${headers.map((h) => `<td style="border:1px solid #ddd;padding:6px 10px;font-size:12px">${escHtml(r[h])}</td>`).join("")}</tr>`,
        )
        .join("");
      const html = `
        <html><head><title>${mod.label} — ${year}</title>
        <style>body{font-family:sans-serif;margin:24px}h1{font-size:18px;margin-bottom:4px}p{color:#666;font-size:13px;margin-bottom:16px}table{border-collapse:collapse;width:100%}th{background:#4f46e5;color:#fff;padding:7px 10px;font-size:12px;text-align:left}tr:nth-child(even){background:#f5f5f5}@media print{button{display:none}}</style>
        </head><body>
        <h1>${escHtml(mod.label)}</h1><p>${escHtml(mod.description)} · ${year}</p>
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
  const [deptDeleteConfirm, setDeptDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

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
                onClick={() => setDeptDeleteConfirm({ id: d.id, name: d.name })}
                aria-label={`Remove ${d.name}`}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={!!deptDeleteConfirm} onOpenChange={(v) => !v && setDeptDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove department?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the <strong>{deptDeleteConfirm?.name}</strong> department. Staff assigned to it will lose their department link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deptDeleteConfirm) { remove.mutate(deptDeleteConfirm.id); setDeptDeleteConfirm(null); } }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function PasswordResetRequests() {
  const qc = useQueryClient();
  const resetFn = useServerFn(directPasswordReset);
  const fetchRequests = useServerFn(fetchPasswordResetRequests);
  const completeRequest = useServerFn(completePasswordResetRequest);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["password-reset-requests"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: () => fetchRequests(),
  });

  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function handleSetTemp(req: { id: string; teacher_id: string; full_name: string }) {
    const pw = tempPasswords[req.id]?.trim();
    if (!pw || pw.length < 8) return toast.error("Temporary password must be at least 8 characters");
    setBusy(req.id);
    try {
      await resetFn({ data: { targetUserId: req.teacher_id, newPassword: pw } });
      await completeRequest({ data: { requestId: req.id } });
      toast.success(`Temporary password set for ${req.full_name}`);
      setTempPasswords((prev) => { const n = { ...prev }; delete n[req.id]; return n; });
      qc.invalidateQueries({ queryKey: ["password-reset-requests"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return (
    <SectionCard title="Password Reset Requests" subtitle="Loading...">
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="size-4 animate-spin" /> Checking for requests...
      </div>
    </SectionCard>
  );

  if (requests.length === 0) return (
    <SectionCard title="Password Reset Requests" subtitle="No pending requests">
      <p className="text-sm text-muted-foreground py-1">No staff members have requested a password reset.</p>
    </SectionCard>
  );

  return (
    <SectionCard
      title="Password Reset Requests"
      subtitle={`${requests.length} pending — set a temporary password for each`}
    >
      <ul className="space-y-3">
        {requests.map((req) => (
          <li key={req.id} className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">{req.full_name}</p>
                <p className="text-xs text-muted-foreground">College ID: {req.college_id}</p>
                <p className="text-xs text-muted-foreground">
                  Requested: {new Date(req.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Set temporary password (min 8 chars)"
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm bg-background outline-none focus:ring-2 focus:ring-primary/30"
                value={tempPasswords[req.id] ?? ""}
                onChange={(e) => setTempPasswords((prev) => ({ ...prev, [req.id]: e.target.value }))}
              />
              <Button
                size="sm"
                disabled={busy === req.id || !tempPasswords[req.id]?.trim()}
                onClick={() => handleSetTemp(req)}
              >
                {busy === req.id ? <Loader2 className="size-4 animate-spin" /> : "Set"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}