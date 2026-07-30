import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth";

export function Guarded({ roles, children }: { roles?: AppRole[]; children: ReactNode }) {
  const { session, role, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  // Keep showing spinner until BOTH session AND profile are ready.
  // auth.tsx loads the profile asynchronously after the session is set,
  // so there's a brief window where session is set but profile is null —
  // without this check, Guard would flash "no profile" on every sign-in.
  if (loading || !session || (session && !profile && !loading)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Your account has no profile yet. Please sign out and register again.
        </p>
      </div>
    );
  }

  if (!profile.approved && role !== "admin") {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-xl font-extrabold tracking-tight">Waiting for approval</h1>
          <p className="text-sm text-muted-foreground">
            Your registration has been received. The college administrator needs to approve your
            account before you can use the leave management system.
          </p>
          <p className="text-xs text-muted-foreground">
            Signed in as {profile.full_name} · {profile.user_id}
          </p>
        </div>
      </div>
    );
  }

  if (roles && role && !roles.includes(role)) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <p className="text-sm text-muted-foreground">You do not have access to this page.</p>
      </div>
    );
  }


  return <>{children}</>;
}
