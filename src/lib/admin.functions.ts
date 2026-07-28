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
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const email = data.email.trim().toLowerCase();
    if (!email || data.password.length < 8) throw new Error("Email and an 8+ character password are required");
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

    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: uid,
      user_id: email,
      full_name: data.fullName,
      designation: data.designation,
      department_id: dept,
      monthly_salary: data.monthlySalary,
      approved: true,
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
