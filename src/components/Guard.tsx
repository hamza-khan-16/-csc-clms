import { useEffect, type ReactNode } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { Loader2, FileUp, LogOut, CheckCircle2 } from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

async function signOutAndRedirect(navigate: ReturnType<typeof useNavigate>) {
  await supabase.auth.signOut();
  navigate({ to: "/", replace: true });
}

export function Guarded({ roles, children }: { roles?: AppRole[]; children: ReactNode }) {
  const { session, role, profile, loading, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

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
        <button onClick={() => signOutAndRedirect(navigate)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
          <LogOut className="size-4" /> Sign Out
        </button>
      </div>
    );
  }

  // ── Step 1: Admin must approve the account ─────────────────────────────────
  if (!profile.approved && role !== "admin" && role !== "hr") {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="max-w-sm space-y-4 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted">
            <Loader2 className="size-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">Waiting for admin approval</h1>
          <p className="text-sm text-muted-foreground">
            Your registration has been received. The college administrator needs to approve
            your account before you can sign in.
          </p>
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{profile.full_name}</span> · {profile.user_id}
          </p>
          <button
            onClick={() => signOutAndRedirect(navigate)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors w-full justify-center"
          >
            <LogOut className="size-4" /> Sign Out / Go Back to Login
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Teacher onboarding doc gate (teachers only) ───────────────────
  // HOD and HR skip this entirely — only teachers need to upload documents
  if (role === "teacher" && profile.approved) {

    // HR rejected — show reason + re-upload + request again
    if (profile.hr_approved === false) {
      async function requestAgain() {
        await supabase
          .from("profiles")
          .update({ hr_approved: null, hr_rejection_reason: null })
          .eq("id", profile!.id);
        await refresh();
      }

      return (
        <div className="grid min-h-screen place-items-center px-6">
          <div className="max-w-sm space-y-4 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <FileUp className="size-6 text-destructive" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight">Documents rejected</h1>
            <p className="text-sm text-muted-foreground">
              HR has reviewed your documents and requested changes.
            </p>
            {profile.hr_rejection_reason && (
              <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive text-left">
                <span className="font-semibold block mb-1">Reason from HR:</span>
                {profile.hr_rejection_reason}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Please go to the upload page, replace any rejected documents, then click "Request Again" to notify HR for re-review.
            </p>
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground w-full justify-center"
            >
              <FileUp className="size-4" /> Re-upload Documents
            </Link>
            <button
              onClick={requestAgain}
              className="inline-flex items-center gap-2 rounded-lg border border-primary px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors w-full justify-center"
            >
              <CheckCircle2 className="size-4" /> Request Again (Submit for HR Re-review)
            </button>
            <button
              onClick={() => signOutAndRedirect(navigate)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors w-full justify-center"
            >
              <LogOut className="size-4" /> Sign Out / Go Back to Login
            </button>
            <p className="text-xs text-muted-foreground">
              Signed in as {profile.full_name} · {profile.user_id}
            </p>
          </div>
        </div>
      );
    }

    // HR not yet approved — show upload prompt
    if (profile.hr_approved === null) {
      return (
        <div className="grid min-h-screen place-items-center px-6">
          <div className="max-w-sm space-y-4 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
              <FileUp className="size-6 text-primary" />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight">Upload your documents</h1>
            <p className="text-sm text-muted-foreground">
              Your account has been approved by the admin. Please upload your onboarding
              documents for HR verification to unlock all features.
            </p>
            <ul className="text-left text-sm text-muted-foreground space-y-1 pl-4 list-disc">
              <li>Degree certificate <span className="text-destructive font-medium">*required</span></li>
              <li>Marksheet <span className="text-destructive font-medium">*required</span></li>
              <li>Previous salary slip <span className="text-muted-foreground text-xs">(optional)</span></li>
              <li>Experience letter <span className="text-muted-foreground text-xs">(optional)</span></li>
            </ul>
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground w-full justify-center"
            >
              <FileUp className="size-4" /> Upload Documents
            </Link>
            <button
              onClick={() => signOutAndRedirect(navigate)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors w-full justify-center"
            >
              <LogOut className="size-4" /> Sign Out / Go Back to Login
            </button>
            <p className="text-xs text-muted-foreground">
              Signed in as {profile.full_name} · {profile.user_id}
            </p>
          </div>
        </div>
      );
    }
    // hr_approved === true → fall through to normal render
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
