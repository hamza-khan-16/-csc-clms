import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "teacher" | "hod" | "principal" | "admin";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  designation: string;
  department_id: string | null;
  department_name?: string | null;
  monthly_salary: number;
  approved: boolean;
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
          "id, user_id, full_name, designation, department_id, monthly_salary, approved, departments(name)",
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
      });

    } else {
      setProfile(null);
    }
    setRole((r?.role as AppRole | undefined) ?? null);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setRole(null);
        setLoading(false);
      } else {
        setTimeout(() => {
          loadProfile(next.user.id).finally(() => setLoading(false));
        }, 0);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

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
