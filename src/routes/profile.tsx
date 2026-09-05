import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBalances } from "@/hooks/useBalances";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GuardedInput, type GuardHandle } from "@/components/GuardedField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, Check, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

const GENDERS: { value: string; label: string }[] = [
  { value: "male",   label: "Male" },
  { value: "female", label: "Female" },
  { value: "other",  label: "Other" },
];

// ── DOB helpers ───────────────────────────────────────────────────────────────
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
function daysInMonth(month: string, year: string): number {
  const m = parseInt(month);
  const y = parseInt(year) || 2000; // use a leap year as default so Feb gets 29
  if (!m) return 31;
  return new Date(y, m, 0).getDate();
}

function parseDob(val: string): { day: string; month: string; year: string } {
  if (!val) return { day: "", month: "", year: "" };
  // Handle legacy YYYY-MM-DD (from old HTML date input)
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split("-");
    return { day: d, month: m, year: y };
  }
  const parts = val.split("-");
  return { day: parts[0] ?? "", month: parts[1] ?? "", year: parts[2] ?? "" };
}

function buildDob(day: string, month: string, year: string): string {
  if (!day || !month) return "";
  return year ? `${day}-${month}-${year}` : `${day}-${month}`;
}

function DobPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = parseDob(value);
  const [day,   setDay]   = useState(parsed.day);
  const [month, setMonth] = useState(parsed.month);
  const [year,  setYear]  = useState(parsed.year);

  // Compute valid days for the selected month/year — prevents invalid combos like Feb 31
  const maxDay = daysInMonth(month, year);
  const days = Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, "0"));

  function update(d: string, m: string, y: string) {
    // Clamp day if month change reduces the max days (e.g. Jan 31 → Feb → clamp to 28/29)
    const max = daysInMonth(m, y);
    const clampedDay = parseInt(d) > max ? String(max).padStart(2, "0") : d;
    setDay(clampedDay); setMonth(m); setYear(y);
    onChange(buildDob(clampedDay, m, y));
  }

  return (
    <div className="space-y-2">
      <Label>Date of Birth <span className="text-muted-foreground text-xs">(optional — year is optional)</span></Label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[80px_1fr_100px]">
        <Select value={day} onValueChange={(v) => update(v, month, year)}>
          <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            {days.map((d) => <SelectItem key={d} value={d}>{parseInt(d)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={(v) => update(day, v, year)}>
          <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Year (opt.)"
          value={year}
          maxLength={4}
          inputMode="numeric"
          onChange={(e) => {
            const y = e.target.value.replace(/\D/g, "");
            update(day, month, y);
          }}
        />
      </div>
      {day && month && (
        <p className="text-xs text-muted-foreground">
          Saved as: <span className="font-mono font-medium text-foreground">{buildDob(day, month, year) || "—"}</span>
          {!year && " (no year)"}
        </p>
      )}
    </div>
  );
}

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "My Profile — CSC Leave Management" },
      { name: "description", content: "Your staff profile, role, department and current leave entitlement." },
      { property: "og:title", content: "My Profile — CSC Leave Management" },
      { property: "og:description", content: "Staff profile and leave entitlement." },
    ],
  }),
  component: () => (
    <Guarded>
      <ProfilePage />
    </Guarded>
  ),
});

function LeaveBalancePanel({ profileId }: { profileId?: string }) {
  const { data: balances = [] } = useBalances(profileId);
  const displayed = balances.filter(b => b.type === "casual" || b.type === "medical");
  if (!displayed.length) return <p className="text-xs text-muted-foreground">No balance data.</p>;
  return (
    <div className="space-y-3">
      {displayed.map(b => {
        const rem = Math.max(b.yearlyCap - b.usedYear, 0);
        const pct = b.yearlyCap > 0 ? Math.min((b.usedYear / b.yearlyCap) * 100, 100) : 0;
        return (
          <div key={b.type} className="space-y-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium">{b.label}</span>
              <span className={rem === 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                {rem}/{b.yearlyCap} left
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfilePage() {
  const { profile, role, session } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? "");
  const nameGuardRef = useRef<GuardHandle>(null);
  const [gender, setGender] = useState(profile?.gender ?? "");
  const [dob, setDob] = useState(profile?.date_of_birth ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    supabase.storage.from("avatars").list("", { search: `${profile.id}.jpg` })
      .then(({ data }) => {
        if (data && data.some((f) => f.name === `${profile.id}.jpg`)) {
          return supabase.storage.from("avatars").createSignedUrl(`${profile.id}.jpg`, 3600);
        }
        return null;
      })
      .then((res) => { if (res?.data?.signedUrl) setAvatarUrl(res.data.signedUrl); })
      .catch(() => {});
  }, [profile?.id]);

  async function uploadAvatar(file: File) {
    if (!profile?.id) return;
    if (file.size > 2 * 1024 * 1024) return toast.error("Image must be under 2 MB");
    setAvatarBusy(true);
    try {
      const { error } = await supabase.storage.from("avatars")
        .upload(`${profile.id}.jpg`, file, { upsert: true, contentType: "image/jpeg" });
      if (error) { toast.error(error.message); return; }
      const { data } = await supabase.storage.from("avatars").createSignedUrl(`${profile.id}.jpg`, 3600);
      if (data?.signedUrl) setAvatarUrl(data.signedUrl + `&t=${Date.now()}`);
      toast.success("Photo updated");
    } finally {
      setAvatarBusy(false);
    }
  }

  // Password change state
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);

  // Show/hide toggles
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return toast.error("Enter your full name");
    const guardErr = await nameGuardRef.current?.validateNow();
    if (guardErr) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim(),
        gender: (gender || null) as "female" | "male" | "other" | null,
        date_of_birth: dob || null,
      })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    qc.invalidateQueries();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPw) return toast.error("Enter your current password");
    if (newPw.length < 12) return toast.error("New password must be at least 12 characters");
    if (newPw !== confirmPw) return toast.error("New passwords do not match");
    if (oldPw === newPw) return toast.error("New password must be different from your current password");

    setPwBusy(true);

    // Step 1: Verify old password by re-authenticating
    const email = session?.user?.email;
    if (!email) { setPwBusy(false); return toast.error("Session error — please reload"); }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: oldPw,
    });

    if (signInError) {
      setPwBusy(false);
      return toast.error("Current password is incorrect");
    }

    // Step 2: Update password
    const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
    // Sign out all other sessions so old sessions are invalidated
    if (!updateError) {
      await supabase.auth.signOut({ scope: "others" }).catch(() => {});
    }
    if (updateError) { setPwBusy(false); return toast.error(updateError.message); }

    // Step 3: Update password_changed_at to restart the 90-day clock
    await supabase
      .from("profiles")
      .update({ password_changed_at: new Date().toISOString() })
      .eq("id", profile!.id);

    setPwBusy(false);
    setPwSuccess(true);
    setOldPw("");
    setNewPw("");
    setConfirmPw("");
    toast.success("Password changed successfully");
    qc.invalidateQueries();

    setTimeout(() => setPwSuccess(false), 4000);
  }

  // Password strength indicator (12-char minimum)
  const strength = (() => {
    if (!newPw) return null;
    let score = 0;
    if (newPw.length >= 12) score++;
    if (newPw.length >= 16) score++;
    if (/[A-Z]/.test(newPw)) score++;
    if (/[0-9]/.test(newPw)) score++;
    if (/[^A-Za-z0-9]/.test(newPw)) score++;
    if (score <= 2) return { label: "Weak", color: "bg-destructive", width: "w-1/4" };
    if (score <= 3) return { label: "Fair", color: "bg-warning", width: "w-2/4" };
    if (score <= 4) return { label: "Good", color: "bg-info", width: "w-3/4" };
    return { label: "Strong", color: "bg-success", width: "w-full" };
  })();

  return (
    <AppShell title="My Profile" subtitle="Account details and settings">
      <div className="space-y-6">
        {/* College info banner — full width */}
        <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/8 to-primary/4 px-5 py-4">
          <div className="size-12 rounded-full bg-primary/15 flex items-center justify-center text-xl font-bold text-primary shrink-0">
            {profile?.full_name?.slice(0, 1).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-base truncate">{profile?.full_name}</p>
            <p className="text-sm text-muted-foreground capitalize">{role} · {profile?.designation ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{profile?.department_name ?? "No department assigned"} · Chandrabhan Sharma College</p>
          </div>
          {profile?.date_of_birth && (
            <div className="hidden sm:block text-right shrink-0">
              <p className="text-xs text-muted-foreground">Date of Birth</p>
              <p className="text-sm font-semibold">{profile.date_of_birth}</p>
            </div>
          )}
        </div>

        {/* 3-column grid: Details | Password | Account Info */}
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr_300px]">

        {/* Details card */}
        <SectionCard title="Details">
          <form onSubmit={save} className="space-y-4">

            {/* Avatar upload */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="size-16 rounded-full bg-accent flex items-center justify-center overflow-hidden text-lg font-bold text-accent-foreground border-2 border-border">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="avatar" className="size-full object-cover" onError={() => setAvatarUrl(null)} />
                    : profile?.full_name?.slice(0, 2).toUpperCase()
                  }
                </div>
                <label className="absolute -bottom-1 -right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                  {avatarBusy
                    ? <Loader2 className="size-3 animate-spin" />
                    : <Camera className="size-3" />
                  }
                  <input type="file" accept="image/*" className="sr-only" disabled={avatarBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }} />
                </label>
              </div>
              <div>
                <p className="text-sm font-semibold">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground">Click the camera to update photo · Max 2 MB</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <GuardedInput ref={nameGuardRef} fieldName="Full name" id="name" value={name} onChange={setName} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={session?.user.email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>College ID</Label>
              <Input value={profile?.user_id ?? ""} disabled />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={role ?? ""} disabled className="capitalize" />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={profile?.designation ?? ""} disabled className="capitalize" />
              </div>
            </div>
            {profile?.gender !== undefined && (
              <div className="space-y-2">
                <Label htmlFor="gender">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger id="gender">
                    <SelectValue placeholder="Select gender…" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DobPicker value={dob} onChange={setDob} />
            {role !== "admin" && profile?.password_changed_at && (
              <div className="space-y-1">
                <Label>Password expiry</Label>
                <p className="text-sm text-muted-foreground">
                  {(() => {
                    const daysLeft = Math.ceil(
                      (new Date(profile.password_changed_at).getTime() + 90 * 86400000 - Date.now()) / 86400000
                    );
                    return daysLeft > 0
                      ? `Expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} (every 90 days)`
                      : "Password has expired — please change it now";
                  })()}
                </p>
              </div>
            )}
            <Button type="submit" disabled={busy} className={saved ? "bg-success text-success-foreground hover:bg-success/90" : ""}>
              {saved ? <span className="inline-flex items-center gap-1"><Check className="size-4"/>Saved</span> : busy ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </SectionCard>

        {/* Password change card — immediate, no approval needed */}
        <SectionCard title="Change Password">
          {pwSuccess ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-success/15">
                <CheckCircle2 className="size-7 text-success" />
              </div>
              <div>
                <p className="font-semibold text-success-foreground">Password changed!</p>
                <p className="text-xs text-muted-foreground mt-1">Your new password is active immediately.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={changePassword} className="space-y-4">
              {/* Info banner */}
              <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                <KeyRound className="size-3.5 mt-0.5 shrink-0" />
                <span>Enter your current password to verify your identity, then set a new one. The change takes effect immediately.</span>
              </div>

              {/* Current password */}
              <div className="space-y-2">
                <Label htmlFor="oldpw">Current password</Label>
                <div className="relative">
                  <Input
                    id="oldpw"
                    type={showOld ? "text" : "password"}
                    placeholder="Your current password"
                    value={oldPw}
                    onChange={(e) => setOldPw(e.target.value)}
                    className="pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowOld((v) => !v)}
                    tabIndex={-1}
                    aria-label={showOld ? "Hide password" : "Show password"}
                  >
                    {showOld ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex-1 h-px bg-border" />
                <span>New password</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* New password */}
              <div className="space-y-2">
                <Label htmlFor="newpw">New password</Label>
                <div className="relative">
                  <Input
                    id="newpw"
                    type={showNew ? "text" : "password"}
                    placeholder="At least 12 characters"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    minLength={12}
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowNew((v) => !v)}
                    tabIndex={-1}
                    aria-label={showNew ? "Hide password" : "Show password"}
                  >
                    {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {/* Strength bar */}
                {strength && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${strength.color} ${strength.width}`} />
                    </div>
                    <p className={`text-xs font-medium ${strength.label === "Weak" ? "text-destructive" : strength.label === "Fair" ? "text-warning-foreground" : strength.label === "Good" ? "text-info" : "text-success"}`}>
                      {strength.label}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-2">
                <Label htmlFor="confirmpw">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirmpw"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repeat new password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    className={`pr-10 ${confirmPw && confirmPw !== newPw ? "border-destructive focus-visible:ring-destructive/20" : confirmPw && confirmPw === newPw ? "border-success focus-visible:ring-success/20" : ""}`}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowConfirm((v) => !v)}
                    tabIndex={-1}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {confirmPw && confirmPw !== newPw && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
                {confirmPw && confirmPw === newPw && (
                  <p className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="size-3" /> Passwords match</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={pwBusy || !oldPw || newPw.length < 12 || !confirmPw || newPw !== confirmPw}
                className="w-full"
              >
                {pwBusy ? "Verifying & changing…" : "Change password"}
              </Button>
            </form>
          )}
        </SectionCard>
        {/* ── Right: account info panel ─────────────────────────── */}
        <div className="hidden lg:flex flex-col gap-4">

          {/* Leave balance snapshot */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave Balance</p>
            <LeaveBalancePanel profileId={profile?.id} />
          </div>

          {/* Account activity */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account Info</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role</span>
                <span className="font-medium capitalize">{role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Department</span>
                <span className="font-medium text-right max-w-[140px] truncate">{profile?.department_name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Designation</span>
                <span className="font-medium text-right max-w-[140px] truncate">{profile?.designation ?? "—"}</span>
              </div>
              {profile?.gender && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gender</span>
                  <span className="font-medium capitalize">{profile.gender}</span>
                </div>
              )}
            </div>
          </div>

          {/* Password health */}
          {role !== "admin" && profile?.password_changed_at && (() => {
            const daysLeft = Math.ceil(
              (new Date(profile.password_changed_at).getTime() + 90 * 86400000 - Date.now()) / 86400000
            );
            const pct = Math.max(0, Math.min((daysLeft / 90) * 100, 100));
            return (
              <div className="rounded-xl border border-border p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password Health</p>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{daysLeft > 0 ? "Expires in" : "Expired"}</span>
                  <span className={`font-semibold ${daysLeft <= 7 ? "text-destructive" : daysLeft <= 20 ? "text-warning-foreground" : "text-success"}`}>
                    {daysLeft > 0 ? `${daysLeft} days` : "Now"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${daysLeft <= 7 ? "bg-destructive" : daysLeft <= 20 ? "bg-warning" : "bg-success"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Resets every 90 days after you change it.</p>
              </div>
            );
          })()}

          {/* Tips */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tips</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span> Keep your gender updated — it affects leave types available to you.</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span> Your college ID is your login username and cannot be changed.</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span> Use a strong password with letters, numbers, and symbols.</li>
            </ul>
          </div>

        </div>

        </div>
      </div>
    </AppShell>
  );
}