import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  CalendarPlus,
  FileText,
  CalendarDays,
  Users,
  Building2,
  PartyPopper,
  BarChart3,
  UserRound,
  LogOut,
  ClipboardCheck,
  Repeat,
  Menu,
  Wallet,
  Megaphone,
  UserMinus,
  ShieldCheck,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NoticeBell } from "@/components/NoticeBell";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
  badge?: number;
};

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const { data: pendingProxies = 0 } = useQuery({
    queryKey: ["pending-proxy-count", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { count } = await supabase
        .from("proxy_assignments")
        .select("id", { count: "exact", head: true })
        .eq("proxy_teacher_id", profile!.id)
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  const items: NavItem[] = [
    { to: "/admin", label: "Admin Panel", icon: ShieldCheck, roles: ["admin"] },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["teacher", "hod", "principal"] },
    { to: "/apply", label: "Apply Leave", icon: CalendarPlus, roles: ["teacher", "hod"] },
    { to: "/leaves", label: "My Leaves", icon: FileText, roles: ["teacher", "hod"] },
    { to: "/schedule", label: "My Schedule", icon: CalendarDays, roles: ["teacher", "hod"] },
    { to: "/proxies", label: "Proxy Assignments", icon: Repeat, roles: ["teacher", "hod"], badge: pendingProxies },
    { to: "/payroll", label: "Payroll", icon: Wallet, roles: ["teacher", "hod"] },
    { to: "/requests", label: "Leave Requests", icon: ClipboardCheck, roles: ["hod", "principal", "admin"] },
    { to: "/mark-leave", label: "Mark Leave", icon: UserMinus, roles: ["hod", "principal"] },
    { to: "/notices", label: "Notices", icon: Megaphone, roles: ["hod", "principal", "admin"] },
    { to: "/teachers", label: "Teachers", icon: Users, roles: ["hod", "principal", "admin"] },
    { to: "/departments", label: "Departments", icon: Building2, roles: ["principal", "admin"] },
    { to: "/holidays", label: "Holidays", icon: PartyPopper, roles: ["teacher", "hod", "principal", "admin"] },
    { to: "/reports", label: "Reports", icon: BarChart3, roles: ["hod", "principal", "admin"] },
    { to: "/profile", label: "Profile", icon: UserRound, roles: ["teacher", "hod", "principal", "admin"] },
  ];

  const visible = items.filter((i) => (role ? i.roles.includes(role) : false));

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/", replace: true });
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {visible.map((item) => {
        const active = pathname === item.to;
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4.5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {!!item.badge && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
      <button
        onClick={handleSignOut}
        className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-muted"
      >
        <LogOut className="size-4.5" />
        Logout
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar py-6 lg:flex">
        <div className="px-5 pb-6">
          <Logo />
        </div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar py-6">
            <div className="px-5 pb-6">
              <Logo />
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
          </div>
          <NoticeBell role={role} />
          <div className="hidden items-center gap-3 sm:flex">
            <div className="text-right">
              <p className="text-sm font-semibold">{profile?.full_name}</p>
              <p className="text-xs capitalize text-muted-foreground">
                {role === "hod" ? "HOD" : role} · {profile?.department_name ?? "College"}
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
              {profile?.full_name?.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
