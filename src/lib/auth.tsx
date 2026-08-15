import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "teacher" | "hod" | "principal" | "admin" | "hr";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  designation: string;
  department_id: string | null;
  department_name?: string | null;
  monthly_salary: number;
  approved: boolean;
  password_changed_at: string | null;
  gender: string | null;
  date_of_birth: string | null;
  account_locked: boolean;
  hr_approved: boolean | null;
  hr_rejection_reason: string | null;
  failed_login_attempts: number;
}


interface AuthState {
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, user_id, full_name, designation, department_id, monthly_salary, approved, password_changed_at, gender, date_of_birth, account_locked, failed_login_attempts, hr_approved, hr_rejection_reason, departments(name)",
        )
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    ]);
    if (p) {
      setProfile({
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        designation: p.designation,
        department_id: p.department_id,
        monthly_salary: Number(p.monthly_salary ?? 0),
        approved: Boolean(p.approved),
        department_name: (p.departments as { name: string } | null)?.name ?? null,
        password_changed_at: (p as any).password_changed_at ?? null,
        gender: (p as any).gender ?? null,
        date_of_birth: (p as any).date_of_birth ?? null,
        account_locked: Boolean((p as any).account_locked),
        hr_approved: (p as any).hr_approved ?? null,
        hr_rejection_reason: (p as any).hr_rejection_reason ?? null,
        failed_login_attempts: Number((p as any).failed_login_attempts ?? 0),
      });

    } else {
      setProfile(null);
    }
    setRole((r?.role as AppRole | undefined) ?? null);
  }

  useEffect(() => {
    let initialised = false;

    const profileLoadEvents = new Set([
      'INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED', 'PASSWORD_RECOVERY',
    ]);

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next || event === 'SIGNED_OUT') {
        setProfile(null);
        setRole(null);
        setLoading(false);
        initialised = true;
      } else if (profileLoadEvents.has(event)) {
        setLoading(true);
        setTimeout(() => {
          loadProfile(next.user.id).finally(() => {
            setLoading(false);
            initialised = true;
          });
        }, 0);
      } else {
        if (!initialised) {
          setLoading(false);
          initialised = true;
        }
      }
    });

    const fallback = setTimeout(() => {
      if (!initialised) setLoading(false);
    }, 2000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, []);

  // ── Realtime: re-fetch profile when HR changes hr_approved / approved ──────
  // This makes the teacher's UI update automatically (no page refresh needed)
  // when an HR admin approves or rejects their onboarding in the HR panel.
  useEffect(() => {
    if (!session?.user.id) return;
    const userId = session.user.id;

    const channel = supabase
      .channel(`profile-changes-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        () => {
          // Profile row was updated — re-fetch to get latest hr_approved, approved, etc.
          loadProfile(userId);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  const value: AuthState = {
    session,
    profile,
    role,
    loading,
    refresh: async () => {
      if (session) await loadProfile(session.user.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
