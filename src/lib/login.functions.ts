import { createServerFn } from "@tanstack/react-start";

/**
 * Resolves a college ID (e.g. priya@CSC.COM) to the account's real login email
 * and signs in. Plain email addresses are passed through unchanged.
 *
 * Also handles account lockout: increments failed_login_attempts on bad password
 * and blocks login when the account is locked.
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let email = data.identifier;
    let profileId: string | null = null;

    if (/@csc\.com$/i.test(email)) {
      // College ID path: fetch profile + auth user in parallel
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, account_locked, failed_login_attempts")
        .ilike("user_id", email)
        .maybeSingle();

      if (!profile) return { error: "Invalid user ID or password" as const };
      profileId = profile.id;

      // Check lockout immediately — no need to hit auth if locked
      if (profile.account_locked) {
        return { error: "Your account has been locked due to too many failed login attempts. Please contact your HOD or Admin to reset your password." as const };
      }

      // Fetch real auth email in parallel with nothing else needed now
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(profile.id);
      if (!user?.user?.email) return { error: "Invalid user ID or password" as const };
      email = user.user.email;

    } else {
      // Plain email path: use getUserByEmail instead of listing ALL users
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserByEmail(email.toLowerCase());
      if (authUser?.user?.id) {
        // Fetch profile + lockout check in one query
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, account_locked, failed_login_attempts")
          .eq("id", authUser.user.id)
          .maybeSingle();

        profileId = profile?.id ?? null;
        if (profile?.account_locked) {
          return { error: "Your account has been locked due to too many failed login attempts. Please contact your HOD or Admin to reset your password." as const };
        }
      }
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

    if (error || !signIn?.session) {
      if (profileId) {
        const MAX_ATTEMPTS = 5;
        // Re-read current attempts (we may not have it for the plain-email path)
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("failed_login_attempts")
          .eq("id", profileId)
          .maybeSingle();
        const attempts = (prof?.failed_login_attempts ?? 0) + 1;
        const shouldLock = attempts >= MAX_ATTEMPTS;
        await supabaseAdmin
          .from("profiles")
          .update({
            failed_login_attempts: attempts,
            ...(shouldLock ? { account_locked: true } : {}),
          })
          .eq("id", profileId);

        if (shouldLock) {
          return { error: `Your account has been locked after ${MAX_ATTEMPTS} failed attempts. Please contact your HOD or Admin to unlock it.` as const };
        }
        const remaining = MAX_ATTEMPTS - attempts;
        return { error: `Invalid user ID or password. ${remaining} attempt(s) remaining before lockout.` as const };
      }
      return { error: "Invalid user ID or password" as const };
    }

    // Successful login — reset failed attempts (fire-and-forget, don't block the response)
    if (profileId) {
      supabaseAdmin
        .from("profiles")
        .update({ failed_login_attempts: 0, account_locked: false })
        .eq("id", profileId)
        .then(() => {});
    }

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    };
  });


/**
 * Registers a new staff account fully server-side using the service-role key.
 * - Generates unique ID: firstname@CSC.COM, firstname2@CSC.COM, ...
 * - Enforces 12-character minimum password
 * - Saves gender and dob to profiles
 */
export const registerStaff = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      email: string;
      password: string;
      fullName: string;
      designation: string;
      departmentId: string | null;
      role: "teacher" | "admin" | "hod" | "hr";
      gender?: string;
      dob?: string | null;
    }) => {
      const email = String(data?.email ?? "").trim().toLowerCase();
      const password = String(data?.password ?? "");
      const fullName = String(data?.fullName ?? "").trim();
      if (!email || !password || !fullName) throw new Error("All fields are required");
      if (password.length < 12) throw new Error("Password must be at least 12 characters");
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

    // HR and HOD don't need department assignment at register time (admin sets it)
    const isNonTeaching = data.role === "admin" || data.role === "hr";
    const dept    = isNonTeaching ? null : data.departmentId;
    const approved = data.role === "admin"; // only admin auto-approves

    // HR users skip the teacher onboarding doc gate — set hr_approved = true immediately
    // HOD and Teacher leave hr_approved = null (HR reviews them if needed)
    const hrApproved = data.role === "hr" ? true : null;

    // 2. Determine unique college ID
    const firstWord = data.fullName
      .replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.|Shri|Smt\.|Er\.|Adv\.)\s*/i, "")
      .split(" ")[0] ?? "";
    const baseId = firstWord.toLowerCase();

    const { data: existingProfiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .ilike("user_id", `${baseId}%@CSC.COM`);

    const existingSet = new Set(
      (existingProfiles ?? [])
        .map((p: { user_id: string }) => p.user_id.toLowerCase())
        .filter((id: string) => {
          const local = id.replace(/@csc\.com$/, "");
          return local === baseId || /^\d+$/.test(local.slice(baseId.length));
        }),
    );

    let collegeUserId = `${baseId}@CSC.COM`;
    if (existingSet.has(collegeUserId.toLowerCase())) {
      let n = 2;
      while (existingSet.has(`${baseId}${n}@csc.com`)) n++;
      collegeUserId = `${baseId}${n}@CSC.COM`;
    }

    const uniqueLocalPart = collegeUserId.replace(/@CSC\.COM$/i, "").toLowerCase();
    const authEmail = `${uniqueLocalPart}.csc@csc.edu`;

    // 3. Create auth user
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password: data.password,
      email_confirm: true,
    });
    if (createError || !created.user)
      return { error: (createError?.message ?? "Could not create account") };

    const uid = created.user.id;

    // 4. Insert profile
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      id: uid,
      user_id: collegeUserId,
      full_name: data.fullName,
      designation: data.designation,
      department_id: dept,
      approved,
      hr_approved: hrApproved,
      ...(data.gender ? { gender: data.gender as "female" | "male" | "other" } : {}),
      ...(data.dob ? { date_of_birth: data.dob } : {}),
      password_changed_at: new Date().toISOString(),
    });
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      return { error: profileError.message };
    }

    // 5. Insert role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: uid, role: data.role, department_id: dept });
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      return { error: roleError.message };
    }

    // 6. For admin: sign in immediately
    if (data.role === "admin") {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
        email: authEmail,
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

    // Notify admins of the new registration (fire-and-forget)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: adminRoles } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", "admin");
      const adminUserIds = (adminRoles ?? []).map((r: any) => r.user_id);
      const { data: adminProfiles } = await supabaseAdmin
        .from("profiles").select("id").in("id", adminUserIds);
      const adminIds = (adminProfiles ?? []).map((p: any) => p.id);
      if (adminIds.length > 0) {
        const { notifyNewRegistration } = await import("@/lib/push.functions");
        notifyNewRegistration(adminIds, data.fullName, data.role).catch(() => {});
      }
    } catch {}

    return { role: data.role as "teacher" | "hod" | "hr", collegeUserId };
  });

/**
 * Resolves what college ID a given first name would get if registered right now.
 * Uses the service-role key so it can read profiles regardless of RLS.
 * Safe to call unauthenticated — returns only the candidate ID string.
 */
export const resolvePreviewUserId = createServerFn({ method: "POST" })
  .inputValidator((data: { firstName: string }) => {
    const firstName = String(data?.firstName ?? "").trim();
    return { firstName };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baseId = data.firstName.replace(/\s+/g, "").toLowerCase();
    if (!baseId) return { userId: "" };

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .ilike("user_id", `${baseId}%@CSC.COM`);

    const existingSet = new Set(
      (existing ?? [])
        .map((p: { user_id: string }) => p.user_id.toLowerCase())
        // Only exact-prefix matches: priya@csc.com or priya2@csc.com, NOT priyadarshini@csc.com
        .filter((id: string) => {
          const local = id.replace(/@csc\.com$/, "");
          return local === baseId || /^\d+$/.test(local.slice(baseId.length));
        }),
    );

    let candidate = `${baseId}@CSC.COM`;
    if (existingSet.has(candidate.toLowerCase())) {
      let n = 2;
      while (existingSet.has(`${baseId}${n}@csc.com`)) n++;
      candidate = `${baseId}${n}@CSC.COM`;
    }

    return { userId: candidate };
  });

/**
 * Verifies a college ID exists in profiles.
 * Safe to call unauthenticated — returns only existence + masked name.
 */
export const verifyCollegeId = createServerFn({ method: "POST" })
  .inputValidator((data: { collegeId: string }) => {
    let collegeId = String(data?.collegeId ?? "").trim().toUpperCase();
    if (!collegeId) throw new Error("College ID is required");
    // Append domain if user typed only the local part
    if (!collegeId.includes("@")) collegeId = `${collegeId}@CSC.COM`;
    return { collegeId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    console.log("[verifyCollegeId] looking up:", data.collegeId);
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, user_id")
      .ilike("user_id", data.collegeId)
      .maybeSingle();
    console.log("[verifyCollegeId] result:", profile, "error:", error);
    if (!profile) return { exists: false as const };
    const masked = profile.full_name
      .split(" ")
      .map((w: string) => w.slice(0, 2) + "*".repeat(Math.max(0, w.length - 2)))
      .join(" ");
    return { exists: true as const, maskedName: masked };
  });

/**
 * Submits a forgot-password request using service role (bypasses RLS).
 * Safe to call unauthenticated.
 */
export const submitForgotPasswordRequest = createServerFn({ method: "POST" })
  .inputValidator((data: { collegeId: string }) => {
    let collegeId = String(data?.collegeId ?? "").trim().toUpperCase();
    if (!collegeId) throw new Error("College ID is required");
    if (!collegeId.includes("@")) collegeId = `${collegeId}@CSC.COM`;
    return { collegeId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    console.log("[submitForgotPw] looking up:", data.collegeId);

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, user_id")
      .ilike("user_id", data.collegeId)
      .maybeSingle();
    console.log("[submitForgotPw] profile:", profile, "error:", profileErr);

    if (!profile) return { error: "No account found with that College ID" as const };

    // Check for existing pending request
    const { data: existing } = await supabaseAdmin
      .from("password_reset_requests")
      .select("id")
      .eq("teacher_id", profile.id)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) return { ok: true as const }; // silently succeed — request already there

    const { error } = await supabaseAdmin
      .from("password_reset_requests")
      .insert({
        teacher_id: profile.id,
        full_name:  profile.full_name,
        college_id: profile.user_id,
        status:     "pending",
      });
    console.log("[submitForgotPw] insert error:", error);
    if (error) return { error: `DB error: ${error.message}` as const };
    return { ok: true as const };
  });
