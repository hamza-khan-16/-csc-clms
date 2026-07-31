import { createServerFn } from "@tanstack/react-start";

/**
 * Resolves a college ID (e.g. priya@CSC.COM) to the account's real login email
 * and signs in. Plain email addresses are passed through unchanged.
 */
export const signInWithIdentifier = createServerFn({ method: "POST" })
  .inputValidator((data: { identifier: string; password: string }) => {
    const identifier = String(data?.identifier ?? "").trim();
    const password = String(data?.password ?? "");
    if (!identifier || !password) throw new Error("Enter your user ID and password");
    return { identifier, password };
  })
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    let email = data.identifier;

    if (/@csc\.com$/i.test(email)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("user_id", email)
        .maybeSingle();
      if (!profile) return { error: "Invalid user ID or password" as const };
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(profile.id);
      if (!user?.user?.email) return { error: "Invalid user ID or password" as const };
      email = user.user.email;
    }

    const client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signIn, error } = await client.auth.signInWithPassword({
      email: email.toLowerCase(),
      password: data.password,
    });
    if (error || !signIn.session) return { error: "Invalid user ID or password" as const };

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    };
  });


/**
 * Registers a new staff account fully server-side using the service-role key.
 * This avoids the "Not authenticated" error that happens when email confirmation
 * is enabled and auth.uid() is null right after signUp().
 */
export const registerStaff = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      email: string;
      password: string;
      fullName: string;
      designation: string;
      departmentId: string | null;
      role: "teacher" | "admin";
    }) => {
      const email = String(data?.email ?? "").trim().toLowerCase();
      const password = String(data?.password ?? "");
      const fullName = String(data?.fullName ?? "").trim();
      if (!email || !password || !fullName) throw new Error("All fields are required");
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      if (!/[A-Z]/.test(password)) throw new Error("Password must contain at least 1 uppercase letter");
      if (!/[a-z]/.test(password)) throw new Error("Password must contain at least 1 lowercase letter");
      if (!/[0-9]/.test(password)) throw new Error("Password must contain at least 1 number");
      if (!/[^A-Za-z0-9]/.test(password)) throw new Error("Password must contain at least 1 special character");
      return { ...data, email };
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Guard: only one admin ever
    if (data.role === "admin") {
      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("role", "admin")
        .limit(1);
      if (existing && existing.length > 0)
        return { error: "An administrator is already registered for this college" as const };
    }

    // 2. Create auth user with email already confirmed (no confirmation email needed)
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (createError || !created.user)
      return { error: (createError?.message ?? "Could not create account") };

    const uid = created.user.id;
    const dept = data.role === "admin" ? null : data.departmentId;
    const approved = data.role === "admin";

    // 3. Insert profile — user_id stored as Firstname.CSC.COM for sign-in lookup
    const firstWord = data.fullName.replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.|Shri|Smt\.|Er\.|Adv\.)\s*/i, "").split(" ")[0] ?? "";
    const collegeUserId = firstWord.toLowerCase() + ".CSC.COM";
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: uid,
      user_id: collegeUserId,
      full_name: data.fullName,
      designation: data.designation,
      department_id: dept,
      approved,
    });
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      return { error: profileError.message };
    }

    // 4. Insert role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: uid, role: data.role, department_id: dept });
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      return { error: roleError.message };
    }

    // 5. For admin: sign them in immediately and return session tokens
    if (data.role === "admin") {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError || !signIn.session)
        return { error: "Account created but could not sign in automatically. Please sign in manually." };
      return {
        role: "admin" as const,
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      };
    }

    return { role: "teacher" as const };
  });
