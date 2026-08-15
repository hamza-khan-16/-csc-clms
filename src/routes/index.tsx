import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { signInWithIdentifier, registerStaff, resolvePreviewUserId } from "@/lib/login.functions";
import { Eye, EyeOff, Loader2, UserRound, Fingerprint } from "lucide-react";
import {
  isBiometricAvailable,
  getBiometricCredId,
  getBiometricUser,
  registerBiometric,
  verifyBiometric,
  clearBiometric,
} from "@/lib/biometric";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuardedInput } from "@/components/GuardedField";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign In — CSC Leave Management System" },
      { name: "description", content: "Sign in to the Chandrabhan Sharma College leave management system." },
      { property: "og:title", content: "Sign In — CSC Leave Management System" },
      { property: "og:description", content: "Leave management for teachers, HODs and the principal of CSC." },
    ],
  }),
  component: SignInPage,
});

const SALUTATIONS = [
  "Mr.",
  "Mrs.",
  "Ms.",
  "Miss",
  "Master",
  "Shri",
  "Smt.",
  "Kumari",
  "Sushri",
  "M/S",
  "Dr.",
  "Prof.",
  "Er.",
  "Adv.",
  "CA",
  "Ar.",
  "CS",
  "Hon'ble",
  "Justice",
  "Excellency",
  "Gen.",
  "Lt. Gen.",
  "Maj. Gen.",
  "Brig.",
  "Col.",
  "Lt. Col.",
  "Maj.",
  "Capt.",
  "Lt.",
  "Adm.",
  "Cdr.",
  "ACM",
  "Air Mshl",
  "Wg. Cdr.",
  "Sqn. Ldr.",
];
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

/** Parses stored "DD-MM" or "DD-MM-YYYY" back into parts */
function parseDob(val: string): { day: string; month: string; year: string } {
  if (!val) return { day: "", month: "", year: "" };
  const parts = val.split("-");
  return {
    day:   parts[0] ?? "",
    month: parts[1] ?? "",
    year:  parts[2] ?? "",
  };
}

/** Builds "DD-MM" or "DD-MM-YYYY" from parts */
function buildDob(day: string, month: string, year: string): string {
  if (!day || !month) return "";
  return year ? `${day}-${month}-${year}` : `${day}-${month}`;
}

/** Day/Month picker with optional year for DOB entry */
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[80px_1fr_100px]">
        {/* Day */}
        <Select value={day} onValueChange={(v) => update(v, month, year)}>
          <SelectTrigger><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            {DAYS.map((d) => <SelectItem key={d} value={d}>{parseInt(d)}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Month */}
        <Select value={month} onValueChange={(v) => update(day, v, year)}>
          <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Year — optional free text */}
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

// 12-char minimum + all complexity rules
const PW_RULES = [
  { re: /.{12,}/, label: "At least 12 characters" },
  { re: /[A-Z]/, label: "At least 1 uppercase letter" },
  { re: /[a-z]/, label: "At least 1 lowercase letter" },
  { re: /[0-9]/, label: "At least 1 number" },
  { re: /[^A-Za-z0-9]/, label: "At least 1 special character" },
];

function PasswordStrength({ password }: { password: string }) {
  const results = PW_RULES.map((r) => ({ ...r, ok: r.re.test(password) }));
  const passed = results.filter((r) => r.ok).length;
  const color = passed <= 2 ? "bg-destructive" : passed <= 4 ? "bg-warning" : "bg-success";
  if (!password) return null;
  return (
    <div className="space-y-2 pt-1">
      <div className="flex gap-1 h-1">
        {PW_RULES.map((_, i) => (
          <div key={i} className={`flex-1 rounded-full transition-colors ${i < passed ? color : "bg-muted"}`} />
        ))}
      </div>
      <ul className="space-y-0.5">
        {results.map((r) => (
          <li key={r.label} className={`flex items-center gap-1.5 text-xs ${r.ok ? "text-success" : "text-muted-foreground"}`}>
            <span>{r.ok ? "✓" : "·"}</span> {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignInPage() {
  const navigate = useNavigate();
  const { session, role, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "register">("signin");

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: role === "admin" ? "/admin" : "/dashboard", replace: true });
    }
  }, [loading, session, role, navigate]);

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,480px)_1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-8 overflow-y-auto">
        <Logo />
        <h1 className="mt-10 text-2xl font-extrabold tracking-tight">Leave Management System</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to continue" : "Register your staff account"}
        </p>
        <div className="mt-8">{mode === "signin" ? <SignInForm /> : <RegisterForm onBackToSignIn={() => setMode("signin")} />}</div>
        <button
          className="mt-6 text-sm font-medium text-primary hover:underline"
          onClick={() => setMode(mode === "signin" ? "register" : "signin")}
        >
          {mode === "signin" ? "New staff member? Register an account" : "Already registered? Sign in"}
        </button>
      </div>

      <div className="relative hidden overflow-hidden bg-accent/40 lg:block">
        <div className="absolute inset-0 grid place-items-center p-16">
          <div className="max-w-md">
            <p className="text-3xl font-extrabold leading-tight tracking-tight text-accent-foreground">
              Casual, maternity, bereavement and half-day leave — tracked, approved and proxy-covered.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-foreground/70">
              <li>· 2 casual leaves a month, 12 a year — paid.</li>
              <li>· 10 paid medical leaves per year; beyond that principal decides.</li>
              <li>· HOD assigns proxy lectures, principal gives final approval.</li>
              <li>· Sundays and national holidays are never counted.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioUser, setBioUser] = useState<{ identifier: string; name: string } | null>(null);
  const signIn = useServerFn(signInWithIdentifier);

  // Check biometric availability on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    isBiometricAvailable().then((ok) => {
      if (ok && getBiometricCredId()) {
        setBioAvailable(true);
        setBioUser(getBiometricUser());
      }
    });
  }, []);

  async function doSignIn(identifier: string, pwd: string) {
    const result = await signIn({ data: { identifier: identifier.trim(), password: pwd } });
    if ("error" in result && result.error) throw new Error(result.error);
    const { error } = await supabase.auth.setSession(result);
    if (error) throw error;
    return identifier;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await doSignIn(email, password);
      // After first successful login, offer to register biometric
      const bioOk = await isBiometricAvailable();
      if (bioOk && !getBiometricCredId()) {
        // get display name from email
        const name = email.split("@")[0];
        const registered = await registerBiometric(email.trim(), name);
        if (registered) toast.success("Fingerprint saved — use it next time to sign in faster!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid user ID or password");
    } finally {
      setBusy(false);
    }
  }

  async function handleBiometric() {
    setBioBusy(true);
    try {
      const ok = await verifyBiometric();
      if (!ok) { toast.error("Biometric verification failed. Use your password."); return; }
      const stored = getBiometricUser();
      if (!stored) { toast.error("No saved account. Sign in with password first."); clearBiometric(); return; }
      // Re-authenticate with Supabase using stored session refresh
      // We sign in anonymously via a special token flow — here we just refresh the existing session
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        // Session expired — clear biometric and ask for password
        clearBiometric();
        setBioAvailable(false);
        toast.error("Session expired. Please sign in with your password once.");
        return;
      }
      toast.success(`Welcome back, ${stored.name}!`);
    } catch {
      toast.error("Biometric sign-in failed. Use your password.");
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Biometric button — shown only on mobile when registered */}
      {bioAvailable && bioUser && (
        <div className="flex flex-col items-center gap-2 pb-2 sm:hidden">
          <button
            type="button"
            onClick={handleBiometric}
            disabled={bioBusy}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/40 px-8 py-5 w-full active:scale-95 transition-transform disabled:opacity-60"
            aria-label="Sign in with fingerprint"
          >
            {bioBusy ? (
              <Loader2 className="size-10 animate-spin text-primary" />
            ) : (
              <Fingerprint className="size-10 text-primary" strokeWidth={1.25} />
            )}
            <span className="text-sm font-medium text-foreground">
              {bioBusy ? "Verifying…" : `Sign in as ${bioUser.name}`}
            </span>
            <span className="text-xs text-muted-foreground">Use fingerprint or device lock</span>
          </button>
          <div className="flex items-center gap-3 w-full">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or use password</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="userid">User ID</Label>
          <div className="relative">
            <Input
              id="userid"
              type="text"
              required
              placeholder="firstname@CSC.COM or email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pr-10"
            />
            <UserRound className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              required
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
            />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 text-muted-foreground" aria-label="Toggle password visibility">
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Sign In
        </Button>
      </form>
    </div>
  );
}

const REGISTER_ROLES = [
  { value: "teacher", label: "Teacher",   desc: "Apply for leaves, view schedule, payroll" },
  { value: "hod",     label: "HOD",       desc: "Head of Department — approve department leaves" },
  { value: "hr",      label: "HR Admin",  desc: "Manage teacher onboarding and documents" },
] as const;

function RegisterForm({ onBackToSignIn }: { onBackToSignIn: () => void }) {
  const { refresh } = useAuth();
  const register = useServerFn(registerStaff);

  const [registerRole, setRegisterRole] = useState<"teacher" | "hod" | "hr">("teacher");
  const [salutation, setSalutation] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [designation, setDesignation] = useState("Assistant Professor");
  const [departmentId, setDepartmentId] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const isHR = registerRole === "hr";
  const needsDept = registerRole === "teacher" || registerRole === "hod";

  // Live uniqueness check: preview the actual ID that will be assigned (server-side, bypasses RLS)
  const [previewUserId, setPreviewUserId] = useState("");
  const [idChecking, setIdChecking] = useState(false);
  const resolveId = useServerFn(resolvePreviewUserId);
  useEffect(() => {
    const clean = firstName.trim();
    if (!clean) { setPreviewUserId(""); return; }
    setIdChecking(true);
    const t = setTimeout(async () => {
      try {
        const result = await resolveId({ data: { firstName: clean } });
        setPreviewUserId(result.userId);
      } catch {
        setPreviewUserId(`${clean.replace(/\s+/g, "").toLowerCase()}@CSC.COM`);
      } finally {
        setIdChecking(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [firstName]);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-public"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Derived full name
  const fullName = [salutation, firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

  // Password validation — 12-char minimum
  const pwValid = PW_RULES.every((r) => r.re.test(password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!salutation) return toast.error("Please select a salutation");
    if (!firstName.trim()) return toast.error("Please enter your first name");
    if (!gender) return toast.error("Please select a gender");
    if (needsDept && !departmentId) return toast.error("Please select a department");
    if (!pwValid) return toast.error("Password does not meet the requirements");

    const email = `${firstName.trim().toLowerCase()}.csc@csc.edu`;

    setBusy(true);
    try {
      const result = await register({
        data: {
          email,
          password,
          fullName,
          designation,
          departmentId: needsDept ? departmentId : null,
          role: registerRole,
          gender,
          dob: dob || null,
        },
      });
      if ("error" in result && result.error) return toast.error(result.error);
      setPending(true);
      toast.success("Registration submitted for admin approval");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    const roleLabel = REGISTER_ROLES.find((r) => r.value === registerRole)?.label ?? "Staff";
    return (
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold">Registration submitted — awaiting admin approval</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your <strong>{roleLabel}</strong> account request has been received. The college administrator will review and approve it before you can sign in.
          </p>
          {previewUserId && (
            <p className="mt-2 text-xs text-muted-foreground">
              Your college ID will be: <span className="font-mono font-medium text-foreground">{previewUserId}</span>
            </p>
          )}
        </div>
        <Button variant="outline" className="w-full" onClick={onBackToSignIn}>
          ← Back to Sign In
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">

      {/* Role selection */}
      <div className="space-y-2">
        <Label>Registering as</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {REGISTER_ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRegisterRole(r.value)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                registerRole === r.value
                  ? "border-primary bg-primary/8 text-primary ring-1 ring-primary"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <p className="text-xs font-semibold">{r.label}</p>
              <p className="text-[10px] leading-tight mt-0.5 opacity-70">{r.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Salutation + First name + Last name */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[130px_1fr_1fr]">
        <Select value={salutation} onValueChange={setSalutation}>
          <SelectTrigger>
            <SelectValue placeholder="Salutation" />
          </SelectTrigger>
          <SelectContent>
            {SALUTATIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <GuardedInput
          required
          fieldName="First name"
          placeholder="First name"
          value={firstName}
          onChange={setFirstName}
        />
        <GuardedInput
          fieldName="Last name"
          placeholder="Last name"
          value={lastName}
          onChange={setLastName}
        />
      </div>
      {fullName && (
        <p className="text-xs text-muted-foreground">Full name: <span className="font-medium text-foreground">{fullName}</span></p>
      )}

      {/* Gender */}
      <div className="space-y-2">
        <Label>Gender</Label>
        <Select value={gender} onValueChange={setGender}>
          <SelectTrigger>
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            {GENDERS.map((g) => (
              <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date of Birth (optional) */}
      <DobPicker value={dob} onChange={setDob} />

      {/* Auto-generated User ID */}
      <div className="space-y-2">
        <Label htmlFor="userid-preview">User ID (auto-generated)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="userid-preview"
            value={idChecking ? "Checking…" : previewUserId}
            readOnly
            className="bg-muted text-muted-foreground cursor-not-allowed font-mono text-sm"
            placeholder="Enter first name above…"
          />
          {idChecking && <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground">
          This is the exact ID you will use to sign in. A number is appended automatically if the name is already taken (e.g. <span className="font-mono">firstname2@CSC.COM</span>).
        </p>
      </div>

      {/* Password */}
      <div className="space-y-2">
        <Label htmlFor="reg-pass">Password</Label>
        <div className="relative">
          <Input
            id="reg-pass"
            type={showPw ? "text" : "password"}
            required
            placeholder="Create a strong password (min 12 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-10"
          />
          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-2.5 text-muted-foreground" aria-label="Toggle password visibility">
            {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>

      {/* Department + Designation — department hidden for HR */}
      <div className={`grid gap-4 ${needsDept ? "sm:grid-cols-2" : "grid-cols-1"}`}>
        {needsDept && (
          <div className="space-y-2">
            <Label>Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="desig">Designation</Label>
          <Select value={designation} onValueChange={setDesignation}>
            <SelectTrigger id="desig">
              <SelectValue placeholder="Select designation" />
            </SelectTrigger>
            <SelectContent>
              {[
                "Assistant Professor",
                "Associate Professor",
                "Professor",
                "Senior Professor",
                "Head of Department",
                "Principal",
                "Vice Principal",
                "Lecturer",
                "Senior Lecturer",
                "Lab Assistant",
                "Teaching Assistant",
                "HR Manager",
                "HR Executive",
                "HR Officer",
              ].map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={busy || !pwValid}>
        {busy && <Loader2 className="size-4 animate-spin" />} Create Account
      </Button>

      <p className="text-xs text-muted-foreground">
        All accounts require admin approval before you can sign in.
        {registerRole === "teacher" && " After approval, upload your documents for HR verification to unlock all features."}
        {registerRole === "hr" && " HR accounts skip the document upload step."}
      </p>
    </form>
  );
}
