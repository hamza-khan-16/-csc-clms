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
    let initialised = false;

    // onAuthStateChange fires INITIAL_SESSION synchronously with the stored
    // session, so we don't need a separate getSession() call — that would
    // trigger a second token refresh and hit the 429 rate limit.
    //
    // TOKEN_REFRESHED fires every ~55 minutes when the access token auto-renews.
    // We deliberately skip reloading the profile on that event — the user/role
    // data hasn't changed, and re-fetching would hammer the DB and auth endpoints.
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
        // Keep loading=true until profile is fully fetched so Guard never
        // flashes the "no profile" message between session arriving and profile loading.
        setLoading(true);
        // Use setTimeout(0) so Supabase internal state settles before we
        // make additional DB queries with the new token.
        setTimeout(() => {
          loadProfile(next.user.id).finally(() => {
            setLoading(false);
            initialised = true;
          });
        }, 0);
      } else {
        // TOKEN_REFRESHED or other events — just update loading state
        if (!initialised) {
          setLoading(false);
          initialised = true;
        }
      }
    });

    // Safety fallback: if onAuthStateChange never fires (e.g. no session),
    // stop the loading spinner after a short delay.
    const fallback = setTimeout(() => {
      if (!initialised) setLoading(false);
    }, 2000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(fallback);
    };
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
