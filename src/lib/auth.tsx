import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { initPush, logoutPush, registerNotificationTapHandler } from "@/lib/push";

// Detect Median.co native WebView — same check used in AppShell
const IS_NATIVE_APP =
  typeof navigator !== "undefined" &&
  /GoNative|Median/i.test(navigator.userAgent);

export type AppRole = "teacher" | "hod" | "principal" | "admin" | "hr";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  name?: string | null;
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
  phone: string | null;
  session_token: string | null;
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

  // useCallback keeps loadProfile reference stable so realtime listeners and
  // auth event handlers don't close over a stale version (#4)
  const loadProfile = useCallback(async (userId: string) => {
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, user_id, full_name, designation, department_id, monthly_salary, approved, password_changed_at, gender, date_of_birth, account_locked, failed_login_attempts, hr_approved, hr_rejection_reason, phone, departments(name)",
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
        phone: (p as any).phone ?? null,
        session_token: null, // fetched separately via raw query to avoid TS type issues
      });
    } else {
      setProfile(null);
    }
    setRole((r?.role as AppRole | undefined) ?? null);
  }, []);

  useEffect(() => {
    let initialised = false;

    // Register the global notification tap handler for Median bridge
    registerNotificationTapHandler();

    const profileLoadEvents = new Set([
      'INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED', 'PASSWORD_RECOVERY', 'TOKEN_REFRESHED',
    ]);

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next || event === 'SIGNED_OUT') {
        // Clear single-device token so next login on this device starts fresh
        try {
          const userId = session?.user?.id;
          if (userId) localStorage.removeItem(`sdt:${userId}`);
        } catch (_) {}
        setProfile(null);
        setRole(null);
        setLoading(false);
        initialised = true;
        logoutPush(); // unlink device from OneSignal on logout
      } else if (profileLoadEvents.has(event)) {
        setLoading(true);
        setTimeout(() => {
          loadProfile(next.user.id).finally(async () => {
            setLoading(false);
            initialised = true;

            // ── Single-device enforcement (Median only, on every app open) ──
            if (IS_NATIVE_APP && event === 'INITIAL_SESSION') {
              const localToken = localStorage.getItem(`sdt:${next.user.id}`);
              if (localToken) {
                // Compare local token against DB — if different, another device logged in
                const { data: p } = await (supabase as any)
                  .from("profiles")
                  .select("session_token")
                  .eq("id", next.user.id)
                  .maybeSingle();
                const dbToken = p?.session_token ?? null;
                if (dbToken && dbToken !== localToken) {
                  localStorage.removeItem(`sdt:${next.user.id}`);
                  supabase.auth.signOut({ scope: "local" });
                  return;
                }
              } else {
                // No local token — localStorage was cleared (reinstall/cache clear).
                // Write a fresh token so this device is now the authoritative one.
                // This is safe: if another device is logged in, the next login from
                // either device will overwrite and kick the other out.
                const newToken = crypto.randomUUID();
                localStorage.setItem(`sdt:${next.user.id}`, newToken);
                (supabase as any).from("profiles")
                  .update({ session_token: newToken })
                  .eq("id", next.user.id)
                  .then(() => {});
              }
            }

            // Register device for push notifications after profile loads.
            // Run on INITIAL_SESSION too so token is refreshed on every app open.
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
              // ── Single-device: write new token on login (Median only) ──
              // Do this first, synchronously, before initPush or any other
              // async work — so a crash/kill after login still persists the token.
              if (IS_NATIVE_APP && event === 'SIGNED_IN') {
                const newToken = crypto.randomUUID();
                try { localStorage.setItem(`sdt:${next.user.id}`, newToken); } catch (_) {}
                (supabase as any).from("profiles")
                  .update({ session_token: newToken })
                  .eq("id", next.user.id)
                  .then(() => {});
              }

              initPush(next.user.id, next.access_token?.slice(-16));
              // Password expiry push — send once per session, not on every app open
              const expiryKey = `pw_expiry_push:${next.user.id}`;
              const alreadySent = sessionStorage.getItem(expiryKey);
              if (!alreadySent) {
                // Check expiry after profile loads (setTimeout 0 defers to after loadProfile)
                setTimeout(async () => {
                  const { data: p } = await supabase
                    .from("profiles")
                    .select("password_changed_at")
                    .eq("id", next.user.id)
                    .maybeSingle();
                  if (p?.password_changed_at) {
                    const PW_EXPIRY_DAYS = 180;
                    const expiresAt = new Date(p.password_changed_at).getTime() + PW_EXPIRY_DAYS * 86400_000;
                    const daysLeft = Math.ceil((expiresAt - Date.now()) / 86400_000);
                    if (daysLeft <= 14) {
                      const { firePush } = await import("@/lib/push.functions");
                      firePush({
                        userIds: [next.user.id],
                        title: daysLeft <= 0 ? "Password Expired" : `Password expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
                        body: daysLeft <= 0
                          ? "Your CSC LMS password has expired. Please change it from your Profile page."
                          : `Your CSC LMS password will expire in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}. Change it from your Profile page.`,
                        targetUrl: "/profile",
                      });
                      sessionStorage.setItem(expiryKey, "1");
                    }
                  }
                }, 2000);
              }
            }
          });
        }, 0);
      } else {
        if (!initialised) {
          setLoading(false);
          initialised = true;
        }
      }
    });

    // ── Single-device enforcement (Median app only) ──────────────────────────
    // On every INITIAL_SESSION (app open / reload), compare the locally-stored
    // session_token against the one in the DB. If they differ, another device
    // has logged in and we must sign out immediately.
    // Only runs inside Median WebView — browser users are not affected.
    const origFetch = window.fetch.bind(window);
    if (IS_NATIVE_APP) {
      window.fetch = async (...args) => {
        const res = await origFetch(...args);
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url ?? "";
        if (
          res.status === 401 &&
          url.includes("/auth/v1/token") &&
          url.includes("grant_type=refresh_token")
        ) {
          supabase.auth.signOut({ scope: "local" }).catch(() => {});
        }
        return res;
      };
    }

    const fallback = setTimeout(() => {
      if (!initialised) setLoading(false);
    }, 5000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(fallback);
      // Restore fetch if we replaced it
      window.fetch = origFetch;
    };
  }, [loadProfile]);

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
  }, [session?.user.id, loadProfile]);

  const value: AuthState = {
    session,
    profile,
    role,
    loading,
    refresh: async () => {
      if (session) await loadProfile(session.user.id);
    },
    signOut: async () => {
      // scope:"global" calls /logout?scope=global which requires a service-role
      // key and returns 403 with an anon/publishable key. scope:"local" simply
      // clears the local session without any server round-trip, which is correct
      // for a frontend-only logout.
      await supabase.auth.signOut({ scope: "local" });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
