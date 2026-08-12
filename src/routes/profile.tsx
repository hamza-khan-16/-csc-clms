import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyRound, Eye, EyeOff, CheckCircle2 } from "lucide-react";

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
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

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

  function update(d: string, m: string, y: string) {
    setDay(d); setMonth(m); setYear(y);
    onChange(buildDob(d, m, y));
  }

  return (
    <div className="space-y-2">
      <Label>Date of Birth <span className="text-muted-foreground text-xs">(optional — year is optional)</span></Label>
      <div className="grid grid-cols-[80px_1fr_100px] gap-2">
        <Select value={day} onValueChange={(v) => update(v, month, year)}>
          <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            {DAYS.map((d) => <SelectItem key={d} value={d}>{parseInt(d)}</SelectItem>)}
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

function ProfilePage() {
  const { profile, role, session } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "");
  const [dob, setDob] = useState(profile?.date_of_birth ?? "");
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim(),
        gender: gender || null,
        date_of_birth: dob || null,
      })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
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
      <div className="grid gap-6 lg:grid-cols-2 max-w-3xl">

        {/* Details card */}
        <SectionCard title="Details">
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={session?.user.email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>College ID</Label>
              <Input value={profile?.user_id ?? ""} disabled />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            <Button type="submit" disabled={busy}>Save changes</Button>
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
      </div>
    </AppShell>
  );
}
