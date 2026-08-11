import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const adminCreateStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      email: string;
      password: string;
      fullName: string;
      designation: string;
      departmentId: string | null;
      role: "teacher" | "hod" | "principal";
      monthlySalary: number;
      gender?: "female" | "male" | "other" | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const email = data.email.trim().toLowerCase();
    // Enforce 12-char minimum + complexity for admin-created accounts
    if (!email) throw new Error("Email is required");
    if (data.password.length < 12) throw new Error("Password must be at least 12 characters");
    if (!/[A-Z]/.test(data.password)) throw new Error("Password must contain at least 1 uppercase letter");
    if (!/[a-z]/.test(data.password)) throw new Error("Password must contain at least 1 lowercase letter");
    if (!/[0-9]/.test(data.password)) throw new Error("Password must contain at least 1 number");
    if (!/[^A-Za-z0-9]/.test(data.password)) throw new Error("Password must contain at least 1 special character");
    if (data.role !== "principal" && !data.departmentId) throw new Error("Please select a department");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.role === "principal") {
      const { data: existing } = await supabaseAdmin.from("user_roles").select("id").eq("role", "principal");
      if (existing && existing.length > 0) throw new Error("A principal is already registered");
    }
    if (data.role === "hod") {
      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("role", "hod")
        .eq("department_id", data.departmentId!);
      if (existing && existing.length > 0) throw new Error("This department already has a HOD");
    }

    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? "Could not create the account");

    const uid = created.data.user.id;
    const dept = data.role === "principal" ? null : data.departmentId;

    // Generate unique college ID: firstname@CSC.COM → firstname2@CSC.COM → …
    // Strip salutation and take the first name word
    const firstWord = data.fullName
      .replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.|Shri|Smt\.|Er\.|Adv\.)\s*/i, "")
      .split(" ")[0] ?? "";
    const baseId = firstWord.toLowerCase();
    let collegeUserId = `${baseId}@CSC.COM`;
    const { data: existingProfiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .ilike("user_id", `${baseId}%@CSC.COM`);
    const existingIds = new Set((existingProfiles ?? []).map((p: { user_id: string }) => p.user_id.toLowerCase()));
    if (existingIds.has(collegeUserId.toLowerCase())) {
      let n = 2;
      while (existingIds.has(`${baseId}${n}@csc.com`)) n++;
      collegeUserId = `${baseId}${n}@CSC.COM`;
    }

    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: uid,
      user_id: collegeUserId,
      full_name: data.fullName,
      designation: data.designation,
      department_id: dept,
      monthly_salary: data.monthlySalary,
      gender: data.gender ?? null,
      approved: true,
      password_changed_at: new Date().toISOString(),
    });
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(profileError.message);
    }

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: uid, role: data.role, department_id: dept });
    if (roleError) throw new Error(roleError.message);

    return { id: uid };
  });

export const adminDeleteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { staffId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    if (data.staffId === context.userId) throw new Error("You cannot remove your own account");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.staffId);
    await supabaseAdmin.from("profiles").delete().eq("id", data.staffId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.staffId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Unlock a locked account and optionally reset the password.
 * Permission rules:
 *   - Teacher: HOD (same dept) or Admin can unlock
 *   - HOD: Principal or Admin can unlock
 *   - Principal: Admin can unlock
 *   - Admin: No one else can unlock
 */
export const unlockAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string; newPassword?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Get actor's role
    const { data: actorRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const actorRole = actorRoleRow?.role ?? "teacher";

    // Get target's role
    const { data: targetRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    const targetRole = targetRoleRow?.role ?? "teacher";

    // Enforce permission matrix
    if (targetRole === "admin") {
      throw new Error("Admin accounts cannot be unlocked by any other role");
    }
    if (targetRole === "teacher") {
      if (actorRole !== "hod" && actorRole !== "admin") {
        throw new Error("Only HOD or Admin can unlock a teacher account");
      }
      // HOD can only unlock teachers in their own department
      if (actorRole === "hod" && actorRoleRow?.department_id !== targetRoleRow?.department_id) {
        throw new Error("HOD can only unlock teachers in their own department");
      }
    }
    if (targetRole === "hod") {
      if (actorRole !== "principal" && actorRole !== "admin") {
        throw new Error("Only Principal or Admin can unlock a HOD account");
      }
    }
    if (targetRole === "principal") {
      if (actorRole !== "admin") {
        throw new Error("Only Admin can unlock a Principal account");
      }
    }

    // Unlock account
    await supabaseAdmin
      .from("profiles")
      .update({ account_locked: false, failed_login_attempts: 0 })
      .eq("id", data.targetUserId);

    // Optionally set a new temporary password
    if (data.newPassword) {
      if (data.newPassword.length < 12) throw new Error("New password must be at least 12 characters");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
        password: data.newPassword,
      });
      if (error) throw new Error(error.message);
      // Reset password_changed_at so expiry clock restarts
      await supabaseAdmin
        .from("profiles")
        .update({ password_changed_at: new Date().toISOString() })
        .eq("id", data.targetUserId);
    }

    return { ok: true };
  });

/**
 * applyPasswordChange
 *
 * Routing rules (updated):
 *  - Teacher  → HOD (same dept) or Admin can approve
 *  - HOD      → Principal or Admin can approve
 *  - Principal → Admin only can approve
 *  - Admin    → nobody can approve (admin has no password change request flow)
 */
export const applyPasswordChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Get actor's role
    const { data: actorRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const actorRole = actorRoleRow?.role ?? "teacher";

    // Fetch the request
    const { data: req, error: fetchErr } = await supabaseAdmin
      .from("password_change_requests")
      .select("id, teacher_id, new_password_temp, status")
      .eq("id", data.requestId)
      .single();
    if (fetchErr || !req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Request already resolved");
    if (!req.new_password_temp) throw new Error("No password stored for this request");

    // Look up requester's role
    const { data: requesterRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", req.teacher_id)
      .maybeSingle();
    const requesterRole = requesterRoleRow?.role ?? "teacher";

    // Enforce routing
    _enforcePasswordChangePermission(actorRole, actorRoleRow?.department_id ?? null, requesterRole, requesterRoleRow?.department_id ?? null, "approve");

    // Update auth password
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(req.teacher_id, {
      password: req.new_password_temp,
    });
    if (authErr) throw new Error(authErr.message);

    // Mark approved and update password_changed_at
    await supabaseAdmin
      .from("password_change_requests")
      .update({
        status: "approved",
        hod_id: context.userId,
        acted_at: new Date().toISOString(),
        new_password_temp: null,
      })
      .eq("id", data.requestId);

    await supabaseAdmin
      .from("profiles")
      .update({ password_changed_at: new Date().toISOString() })
      .eq("id", req.teacher_id);

    return { ok: true };
  });

/**
 * rejectPasswordChange — same routing rules as applyPasswordChange.
 */
export const rejectPasswordChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string; note?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: actorRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const actorRole = actorRoleRow?.role ?? "teacher";

    const { data: req, error: fetchErr } = await supabaseAdmin
      .from("password_change_requests")
      .select("id, teacher_id, status")
      .eq("id", data.requestId)
      .single();
    if (fetchErr || !req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Request already resolved");

    const { data: requesterRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", req.teacher_id)
      .maybeSingle();
    const requesterRole = requesterRoleRow?.role ?? "teacher";

    _enforcePasswordChangePermission(actorRole, actorRoleRow?.department_id ?? null, requesterRole, requesterRoleRow?.department_id ?? null, "reject");

    const { error } = await supabaseAdmin
      .from("password_change_requests")
      .update({
        status: "rejected",
        hod_id: context.userId,
        hod_note: data.note ?? null,
        acted_at: new Date().toISOString(),
        new_password_temp: null,
      })
      .eq("id", data.requestId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Shared permission enforcement for password change requests */
function _enforcePasswordChangePermission(
  actorRole: string,
  actorDeptId: string | null,
  requesterRole: string,
  requesterDeptId: string | null,
  action: "approve" | "reject",
) {
  if (requesterRole === "admin") {
    throw new Error("Admin password cannot be changed by any other role");
  }
  if (requesterRole === "teacher") {
    if (actorRole !== "hod" && actorRole !== "admin") {
      throw new Error(`Only HOD or Admin can ${action} teacher password change requests`);
    }
    if (actorRole === "hod" && actorDeptId !== requesterDeptId) {
      throw new Error("HOD can only manage password requests for teachers in their own department");
    }
  }
  if (requesterRole === "hod") {
    if (actorRole !== "principal" && actorRole !== "admin") {
      throw new Error(`Only Principal or Admin can ${action} HOD password change requests`);
    }
  }
  if (requesterRole === "principal") {
    if (actorRole !== "admin") {
      throw new Error(`Only Admin can ${action} Principal password change requests`);
    }
  }
}

/**
 * directPasswordReset — Admin/HOD/Principal directly sets a new password for a staff member.
 * Same permission matrix as password change requests.
 * Password must be ≥ 12 characters.
 */
export const directPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string; newPassword: string }) => input)
  .handler(async ({ data, context }) => {
    if (data.newPassword.length < 12) throw new Error("Password must be at least 12 characters");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: actorRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const actorRole = actorRoleRow?.role ?? "teacher";

    const { data: targetRoleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role, department_id")
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    const targetRole = targetRoleRow?.role ?? "teacher";

    _enforcePasswordChangePermission(actorRole, actorRoleRow?.department_id ?? null, targetRole, targetRoleRow?.department_id ?? null, "approve");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("profiles")
      .update({
        password_changed_at: new Date().toISOString(),
        account_locked: false,
        failed_login_attempts: 0,
      })
      .eq("id", data.targetUserId);

    return { ok: true };
  });
