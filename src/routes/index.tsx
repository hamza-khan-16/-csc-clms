import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
      {
        name: "description",
        content:
          "Sign in to the Chandrabhan Sharma College leave management system as a teacher, HOD or principal.",
      },
      { property: "og:title", content: "Sign In — CSC Leave Management System" },
      {
        property: "og:description",
        content: "Leave management for teachers, HODs and the principal of CSC.",
      },
    ],
  }),
  component: SignInPage,
});

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
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,460px)_1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
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
          {mode === "signin"
            ? "New staff member? Register an account"
            : "Already registered? Sign in"}
        </button>
      </div>

      <div className="relative hidden overflow-hidden bg-accent/40 lg:block">
        <div className="absolute inset-0 grid place-items-center p-16">
          <div className="max-w-md">
            <p className="text-3xl font-extrabold leading-tight tracking-tight text-accent-foreground">
              Casual, maternity, bereavement and half-day leave — tracked, approved and
              proxy-covered.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-foreground/70">
              <li>· 2 casual leaves a month, 12 a year — paid.</li>
              <li>· Anything beyond your balance is marked as a pay cut.</li>
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
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
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
            placeholder="Email or college ID"
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
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-2.5 text-muted-foreground"
            aria-label="Toggle password visibility"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Sign In
      </Button>
    </form>
  );
}

function RegisterForm() {
  const { refresh } = useAuth();
  const register = useServerFn(registerStaff);
  const [form, setForm] = useState({
    email: "",
    password: "",
    fullName: "",
    designation: "Assistant Professor",
    departmentId: "",
    role: "teacher",
  });
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

  const isAdminRole = form.role === "admin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdminRole && !form.departmentId) return toast.error("Please select a department");
    setBusy(true);
    try {
      const result = await register({
        data: {
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          designation: form.designation,
          departmentId: isAdminRole ? null : form.departmentId,
          role: form.role as "teacher" | "admin",
        },
      });

      if ("error" in result && result.error) {
        return toast.error(result.error);
      }

      if (result.role === "admin" && "access_token" in result) {
        // Admin: set session immediately and navigate
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        if (sessionError) return toast.error(sessionError.message);
        await refresh();
        toast.success("Administrator account created");
      } else {
        // Teacher: account pending HOD approval
        setPending(true);
        toast.success("Registration submitted for approval");
      }
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
          Your department's HOD will review your account. You can sign in once it has been
          approved.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Full Name</Label>
        <Input
          id="name"
          required
          placeholder="Dr. Priya Sharma"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-email">User ID</Label>
        <Input
          id="reg-email"
          type="email"
          required
          placeholder="priya.sharma@csc.edu"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reg-pass">Password</Label>
        <Input
          id="reg-pass"
          type="password"
          required
          minLength={8}
          placeholder="Minimum 8 characters"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Department</Label>
          <Select
            value={isAdminRole ? "" : form.departmentId}
            disabled={isAdminRole}
            onValueChange={(v) => setForm({ ...form, departmentId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder={isAdminRole ? "Not applicable" : "Select department"} />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdminRole && (
            <p className="text-xs text-muted-foreground">
              The administrator oversees every department.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="admin">Administrator (first-time setup)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="desig">Designation</Label>
        <Input
          id="desig"
          value={form.designation}
          onChange={(e) => setForm({ ...form, designation: e.target.value })}
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Create Account
      </Button>
      <p className="text-xs text-muted-foreground">
        Teacher accounts stay pending until their department's HOD approves them. HOD and
        principal accounts are created by the administrator. Only one administrator can be
        registered.
      </p>
    </form>
  );
}
