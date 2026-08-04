import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { signInWithIdentifier, registerStaff } from "@/lib/login.functions";
import { Eye, EyeOff, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
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
  "Mast.",
  "Dr.",
  "Prof.",
  "Er.",
  "Adv.",
  "Ar.",
  "CA",
  "CS",
  "CMA",
  "Shri",
  "Smt.",
  "Sushri",
  "Km.",
  "Kr.",
  "Hon'ble",
  "H.E.",
  "Justice",
  "Gen.",
  "Adm.",
  "ACM",
  "Col.",
  "Maj.",
  "Capt.",
  "Lt.",
  "Cmdr."
];

const PW_RULES = [
  { re: /.{8,}/, label: "At least 8 characters" },
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
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 overflow-y-auto">
        <Logo />
        <h1 className="mt-10 text-2xl font-extrabold tracking-tight">Leave Management System</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to continue" : "Register your staff account"}
        </p>
        <div className="mt-8">{mode === "signin" ? <SignInForm /> : <RegisterForm />}</div>
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
  const signIn = useServerFn(signInWithIdentifier);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await signIn({ data: { identifier: email.trim(), password } });
      if ("error" in result && result.error) { toast.error(result.error); return; }
      const { error } = await supabase.auth.setSession(result);
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid user ID or password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="userid">User ID</Label>
        <div className="relative">
          <Input
            id="userid"
            type="text"
            required
            placeholder="Firstname.CSC.COM"
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
  );
}

function RegisterForm() {
  const { refresh } = useAuth();
  const register = useServerFn(registerStaff);

  const [salutation, setSalutation] = useState("Dr.");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [designation, setDesignation] = useState("Assistant Professor");
  const [departmentId, setDepartmentId] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-public"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Auto-generate User ID from first name
  const userId = useMemo(() => {
    const clean = firstName.trim().replace(/\s+/g, "").toLowerCase();
    return clean ? `${clean}.CSC.COM` : "";
  }, [firstName]);

  // Derived full name
  const fullName = [salutation, firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

  // Password validation
  const pwValid = PW_RULES.every((r) => r.re.test(password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return toast.error("Please enter your first name");
    if (!departmentId) return toast.error("Please select a department");
    if (!pwValid) return toast.error("Password does not meet the requirements");

    // The email for auth is derived from userId (we use it as the auth email)
    const email = `${firstName.trim().toLowerCase()}.csc@csc.edu`;

    setBusy(true);
    try {
      const result = await register({
        data: {
          email,
          password,
          fullName,
          designation,
          departmentId,
          role: "teacher",
        },
      });
      if ("error" in result && result.error) return toast.error(result.error);
      setPending(true);
      toast.success("Registration submitted for approval");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-semibold">Registration submitted</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your department's HOD will review your account. You can sign in once it has been approved.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Salutation + First name + Last name */}
      <div className="space-y-2">
        <Label>Name</Label>
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2">
          <Select value={salutation} onValueChange={setSalutation}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALUTATIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            required
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <Input
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        {fullName && (
          <p className="text-xs text-muted-foreground">Full name: <span className="font-medium text-foreground">{fullName}</span></p>
        )}
      </div>

      {/* Auto-generated User ID */}
      <div className="space-y-2">
        <Label htmlFor="userid-preview">User ID (auto-generated)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="userid-preview"
            value={userId}
            readOnly
            className="bg-muted text-muted-foreground cursor-not-allowed font-mono text-sm"
            placeholder="Enter first name above…"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Use this ID to sign in. Format: <span className="font-mono">firstname.CSC.COM</span>
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
            placeholder="Create a strong password"
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

      {/* Department + Designation */}
      <div className="grid gap-4 sm:grid-cols-2">
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
        Teacher accounts stay pending until their department's HOD approves them. HOD and principal accounts are created by the administrator.
      </p>
    </form>
  );
}
