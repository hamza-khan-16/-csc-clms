import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Clock, CheckCircle2, XCircle } from "lucide-react";
import { applyPasswordChange, rejectPasswordChange } from "@/lib/admin.functions";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — CSC Leave Management" },
      {
        name: "description",
        content: "Your staff profile, role, department and current leave entitlement.",
      },
      { property: "og:title", content: "My Profile — CSC Leave Management" },
      { property: "og:description", content: "Staff profile and leave entitlement." },
    ],
  }),
  component: () => (
    <Guarded>
      <ProfilePage />
    </Guarded>
  ),
});

function ProfilePage() {
  const { profile, role, session } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [busy, setBusy] = useState(false);

  // Password change state
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  // Fetch pending password change request
  const { data: pwRequest } = useQuery({
    queryKey: ["pw-change-request", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase
        .from("password_change_requests")
        .select("id, status, created_at, hod_note")
        .eq("teacher_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // HOD sees only pending teacher requests (filtered by department).
  // Admin sees only pending hod/principal requests.
  // Principal has no approval role in the password change flow.
  const { data: pendingPwRequests = [] } = useQuery({
    queryKey: ["pending-pw-requests", profile?.id, role],
    enabled: role === "hod" || role === "admin",
    queryFn: async () => {
      // Determine which requester_role(s) this approver is responsible for
      const requesterRoles = role === "hod" ? ["teacher"] : ["hod", "principal"];

      // 1. Fetch all pending requests
      const { data: reqs, error } = await supabase
        .from("password_change_requests")
        .select("id, teacher_id, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!reqs || reqs.length === 0) return [];

      // 2. Fetch profiles for the requesters (including their role)
      const teacherIds = [...new Set(reqs.map((r) => r.teacher_id))];
      const { data: peopleRows } = await supabase
        .from("profiles")
        .select("id, full_name, department_id")
        .in("id", teacherIds);
      const peopleMap = Object.fromEntries((peopleRows ?? []).map((p) => [p.id, p]));

      // Fetch the roles of the requesters so we can route correctly
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", teacherIds);
      const roleMap = Object.fromEntries((roleRows ?? []).map((r) => [r.user_id, r.role]));

      // 3. Filter based on approver:
      //    HOD  → only see requests from teachers in their department
      //    Admin → only see requests from hod / principal
      let filtered = reqs;
      if (role === "hod") {
        filtered = reqs.filter(
          (r) =>
            roleMap[r.teacher_id] === "teacher" &&
            peopleMap[r.teacher_id]?.department_id === profile!.department_id,
        );
      } else if (role === "admin") {
        filtered = reqs.filter(
          (r) => roleMap[r.teacher_id] === "hod" || roleMap[r.teacher_id] === "principal",
        );
      }

      return filtered.map((r) => ({
        ...r,
        requester_name: peopleMap[r.teacher_id]?.full_name ?? "Unknown staff",
        requester_role: roleMap[r.teacher_id] ?? "staff",
      }));
    },
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return toast.error("Enter your full name");
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    qc.invalidateQueries();
  }

  async function requestPasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (newPw.length < 8) return toast.error("Password must be at least 8 characters");
    if (newPw !== confirmPw) return toast.error("Passwords do not match");

    // Check no pending request already exists
    if (pwRequest?.status === "pending") {
      return toast.error("You already have a pending password change request");
    }

    if (role === "admin") return toast.error("Admin password cannot be changed through this system");

    setPwBusy(true);
    // Store the new password temporarily — the approver will apply and clear it
    const { error } = await supabase.from("password_change_requests").insert({
      teacher_id: profile!.id,
      new_password_temp: newPw,
      status: "pending",
    });
    setPwBusy(false);
    if (error) return toast.error(error.message);

    const approverLabel = role === "teacher" ? "HOD" : "admin";
    toast.success(`Password change request submitted — awaiting ${approverLabel} approval`);
    setNewPw("");
    setConfirmPw("");
    qc.invalidateQueries({ queryKey: ["pw-change-request"] });
  }

  const applyFn = useServerFn(applyPasswordChange);
  const rejectFn = useServerFn(rejectPasswordChange);

  const approveMutation = useMutation({
    mutationFn: (requestId: string) => applyFn({ data: { requestId } }),
    onSuccess: () => {
      toast.success("Password changed and applied successfully");
      qc.invalidateQueries({ queryKey: ["pending-pw-requests"] });
      qc.invalidateQueries({ queryKey: ["pw-change-request"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (requestId: string) => rejectFn({ data: { requestId } }),
    onSuccess: () => {
      toast.success("Password change rejected");
      qc.invalidateQueries({ queryKey: ["pending-pw-requests"] });
      qc.invalidateQueries({ queryKey: ["pw-change-request"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Label depends on who the approver is for this role
  const approverLabel = role === "teacher" ? "HOD" : "Admin";

  const pwStatusBadge = (status: string | null | undefined) => {
    if (!status) return null;
    if (status === "pending") return <Badge variant="secondary" className="gap-1"><Clock className="size-3" /> Pending {approverLabel} Approval</Badge>;
    if (status === "approved") return <Badge variant="default" className="gap-1 bg-success text-success-foreground"><CheckCircle2 className="size-3" /> Approved</Badge>;
    if (status === "rejected") return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" /> Rejected</Badge>;
    return null;
  };

  // Only HOD and admin have an approval queue (principal doesn't approve anyone)
  const isApprover = role === "hod" || role === "admin";

  return (
    <AppShell title="My Profile" subtitle="Account details and entitlement">
      <div className="grid gap-6 lg:grid-cols-2 max-w-3xl">
        {/* Details card */}
        <SectionCard title="Details">
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={session?.user.email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>College ID</Label>
              <Input value={profile?.user_id ?? ""} disabled />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={role ?? ""} disabled className="capitalize" />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={profile?.designation ?? ""} disabled className="capitalize" />
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              Save changes
            </Button>
          </form>
        </SectionCard>

        {/* Password change card — hidden for admin */}
        {role !== "admin" && <SectionCard title="Change Password" subtitle={`Requires ${approverLabel} approval before taking effect`}>
          {pwRequest?.status === "pending" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
                <p className="font-semibold text-warning-foreground mb-1">Request pending approval</p>
                <p className="text-muted-foreground text-xs">
                  Your password change request is waiting for your HOD to approve it. You will be
                  able to submit a new request once this one is resolved.
                </p>
              </div>
              {pwStatusBadge(pwRequest.status)}
            </div>
          ) : (
            <form onSubmit={requestPasswordChange} className="space-y-4">
              {pwRequest?.status === "rejected" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
                  Your previous request was rejected.
                  {pwRequest.hod_note ? ` Note: ${pwRequest.hod_note}` : ""}
                </div>
              )}
              {pwRequest?.status === "approved" && (
                <div className="rounded-lg border border-success/30 bg-success/8 p-3 text-sm text-success">
                  Your last password change was approved and applied.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="newpw">New Password</Label>
                <Input
                  id="newpw"
                  type="password"
                  placeholder="At least 8 characters"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmpw">Confirm New Password</Label>
                <Input
                  id="confirmpw"
                  type="password"
                  placeholder="Repeat new password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-muted p-2">
                <KeyRound className="size-3.5 shrink-0" />
                <span>Your {approverLabel} must approve this request before your password changes.</span>
              </div>
              <Button type="submit" variant="outline" disabled={pwBusy || !newPw || !confirmPw}>
                {pwBusy ? "Submitting…" : "Request Password Change"}
              </Button>
            </form>
          )}
        </SectionCard>}

        {/* HOD / Admin: pending password change approvals */}
        {isApprover && pendingPwRequests.length > 0 && (
          <div className="lg:col-span-2">
            <SectionCard
              title="Password Change Approvals"
              subtitle={`${pendingPwRequests.length} pending request(s)`}
            >
              <ul className="space-y-3">
                {pendingPwRequests.map((req: any) => (
                  <li
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold">
                        {req.requester_name ?? "Unknown staff"}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {req.requester_role} · Requested{" "}
                        {new Date(req.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        onClick={() => approveMutation.mutate(req.id)}
                      >
                        {approveMutation.isPending ? "Applying…" : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate(req.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        )}
      </div>
    </AppShell>
  );
}
