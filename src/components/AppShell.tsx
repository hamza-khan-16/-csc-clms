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
  Briefcase,
  Menu,
  Wallet,
  Megaphone,
  ShieldCheck,
  Moon,
  Sun,
  Settings2,
  Check,
  WifiOff,
} from "lucide-react";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NoticeBell } from "@/components/NoticeBell";
import { LeaveBot } from "@/components/LeaveBot";

type NavItem = {
  to: string;
  label: string;
  mobileLabel?: string; // shorter label for bottom nav if label truncates
  icon: typeof LayoutDashboard;
  roles: AppRole[];
  badge?: number;
};

function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const up   = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    setOffline(!navigator.onLine);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  if (!offline) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[200] flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground">
      <WifiOff className="size-3.5 shrink-0" />
      You are offline — data may be stale
    </div>
  );
}

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
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // Dark mode — use shared ThemeProvider so login page and app stay in sync
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === "dark";

  // Mobile bottom nav pinned tabs — persisted to Supabase user_metadata
  const [pinnedTabs, setPinnedTabs] = useState<string[]>([]);
  const pinnedTabsLoaded = useRef(false);

  // Load pinned tabs from Supabase session (cached — no network)
  useEffect(() => {
    if (!profile?.id) return;
    supabase.auth.getSession().then(({ data }) => {
      const saved = data?.session?.user?.user_metadata?.pinned_tabs;
      if (Array.isArray(saved)) setPinnedTabs(saved);
      pinnedTabsLoaded.current = true;
    }).catch(() => { pinnedTabsLoaded.current = true; });
  }, [profile?.id]);

  // Sync to Supabase only after initial load to prevent overwriting with []
  useEffect(() => {
    if (!profile?.id || !pinnedTabsLoaded.current) return;
    supabase.auth.updateUser({ data: { pinned_tabs: pinnedTabs } }).catch(() => {});
  }, [pinnedTabs, profile?.id]);

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

  const { data: pendingHR = 0 } = useQuery({
    queryKey: ["pending-hr-count"],
    enabled: role === "hr",
    queryFn: async () => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("approved", true)
        .is("hr_approved", null);
      return count ?? 0;
    },
  });

  const items: NavItem[] = [
    { to: "/admin",         label: "Admin Panel",       icon: ShieldCheck,    roles: ["admin"] },
    { to: "/hr",            label: "HR Panel",          icon: Briefcase,      roles: ["hr"], badge: pendingHR },
    { to: "/admin-reports", label: "Reports",           mobileLabel: "Reports",  icon: BarChart3,      roles: ["admin", "principal"] },
    { to: "/dashboard",     label: "Dashboard",         icon: LayoutDashboard,roles: ["teacher", "hod", "principal"] },
    { to: "/apply",         label: "Apply Leave",       icon: CalendarPlus,   roles: ["teacher", "hod"] },
    { to: "/leaves",        label: "My Leaves",         icon: FileText,       roles: ["teacher", "hod"] },
    { to: "/schedule",      label: "My Schedule",       icon: CalendarDays,   roles: ["teacher", "hod"] },
    { to: "/proxies",       label: "Proxy Assignments", mobileLabel: "Proxies",  icon: Repeat,         roles: ["teacher", "hod"], badge: pendingProxies },
    { to: "/payroll",       label: "Payroll",           icon: Wallet,         roles: ["teacher", "hod"] },
    { to: "/requests",      label: "Leave Requests",    mobileLabel: "Requests", icon: ClipboardCheck, roles: ["hod", "principal", "admin"] },
    { to: "/notices",       label: "Notices",           icon: Megaphone,      roles: ["hod", "principal", "admin"] },
    { to: "/teachers",      label: "Teachers",          icon: Users,          roles: ["hod", "principal", "admin"] },
    { to: "/departments",   label: "Departments",       icon: Building2,      roles: ["principal", "admin"] },
    { to: "/holidays",      label: "Holidays",          icon: PartyPopper,    roles: ["teacher", "hod", "principal", "admin"] },
    { to: "/reports",       label: "Reports",           icon: BarChart3,      roles: ["hod"] },
    { to: "/profile",       label: "Profile",           icon: UserRound,      roles: ["teacher", "hod", "principal", "admin", "hr"] },
  ];

  const visible = items.filter((i) => (role ? i.roles.includes(role) : false));

  // Derive the 5 tabs to show in the mobile bottom nav
  const MAX_MOBILE_TABS = 5;
  const mobileNavItems = (() => {
    if (pinnedTabs.length === 0) return visible.slice(0, MAX_MOBILE_TABS);
    // Keep only pinned tabs that are still in the visible list (role may change)
    const pinned = pinnedTabs
      .map((to) => visible.find((v) => v.to === to))
      .filter((v): v is NavItem => !!v);
    // If fewer than MAX because of role change, pad with first non-pinned visible items
    if (pinned.length < MAX_MOBILE_TABS) {
      const rest = visible.filter((v) => !pinnedTabs.includes(v.to));
      return [...pinned, ...rest].slice(0, MAX_MOBILE_TABS);
    }
    return pinned.slice(0, MAX_MOBILE_TABS);
  })();

  function togglePinned(to: string) {
    setPinnedTabs((prev) => {
      // Seed from the current default display on first manual interaction
      const base = prev.length === 0 ? mobileNavItems.map((i) => i.to) : prev;
      if (base.includes(to)) {
        return base.filter((t) => t !== to); // unpin
      }
      if (base.length < MAX_MOBILE_TABS) return [...base, to]; // pin
      return [...base.slice(0, MAX_MOBILE_TABS - 1), to]; // replace last slot
    });
  }

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
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors relative",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-0.5 before:rounded-r before:bg-primary"
                : "text-sidebar-foreground hover:bg-muted/60",
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
      <OfflineBanner />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar py-6 lg:flex shadow-sm overflow-hidden">
        <div className="px-5 pb-6 shrink-0">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto">
          {nav}
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar py-6 overflow-hidden">
            <div className="px-5 pb-6 shrink-0">
              <Logo />
            </div>
            <div className="flex-1 overflow-y-auto">
              {nav}
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur-md shadow-sm sm:gap-3 sm:px-6 sm:py-4">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold tracking-tight sm:text-xl">{title}</h1>
            {subtitle && <p className="truncate text-[11px] text-muted-foreground sm:text-sm">{subtitle}</p>}
          </div>
          <NoticeBell role={role} userId={profile?.id} />
          <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={toggleTheme}>
            {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
          <div className="hidden items-center gap-3 sm:flex">
            <div className="text-right">
              <p className="text-sm font-semibold">{profile?.full_name}</p>
              <p className="text-xs capitalize text-muted-foreground">
                {role === "hod" ? "HOD" : role === "principal" ? "Principal" : role === "admin" ? "Admin" : role === "hr" ? "HR" : role}
                {(role === "teacher" || role === "hod") && profile?.department_name ? ` · ${profile.department_name}` : ""}
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground overflow-hidden">
              <AvatarCircle name={profile?.full_name} userId={profile?.id} />
            </div>
          </div>
        </header>
        <main className="flex-1 px-3 py-4 pb-20 sm:px-6 sm:py-6 lg:pb-6 page-enter">{children}</main>

        {/* Mobile bottom nav — customisable */}
        <nav className="fixed bottom-0 inset-x-0 z-30 flex lg:hidden border-t border-border bg-background/95 backdrop-blur-md pb-safe">
          {mobileNavItems.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className={cn("relative rounded-lg p-1 transition-colors", active && "bg-primary/10")}>
                  <Icon className="size-5" />
                  {!!item.badge && (
                    <span className="absolute -top-1 -right-1.5 rounded-full bg-primary px-1 py-px text-[8px] font-bold text-primary-foreground leading-none">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="truncate max-w-[56px] text-center leading-tight">{item.mobileLabel ?? item.label}</span>
              </Link>
            );
          })}

          {/* Customise button */}
          <Sheet open={customizeOpen} onOpenChange={setCustomizeOpen}>
            <SheetTrigger asChild>
              <button
                className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Customise navigation tabs"
              >
                <div className="rounded-lg p-1">
                  <Settings2 className="size-5" />
                </div>
                <span className="leading-tight">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-2xl px-4 pb-safe">
              <SheetHeader className="pb-2 pt-1">
                <SheetTitle className="text-base">Customise Tabs</SheetTitle>
                <p className="text-xs text-muted-foreground">
                  Pick up to {MAX_MOBILE_TABS} tabs to pin in your bottom bar.
                </p>
              </SheetHeader>
              <ul className="mt-1 flex flex-col gap-1 pb-4">
                {visible.map((item) => {
                  const Icon = item.icon;
                  const effectivePins = pinnedTabs.length === 0 ? mobileNavItems.map((i) => i.to) : pinnedTabs;
                  const isPinned = effectivePins.includes(item.to);
                  const canAdd = effectivePins.length < MAX_MOBILE_TABS || isPinned;
                  return (
                    <li key={item.to}>
                      <button
                        onClick={() => togglePinned(item.to)}
                        disabled={!isPinned && !canAdd}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                          isPinned
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted text-foreground",
                          !isPinned && !canAdd && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <Icon className="size-5 shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {!!item.badge && (
                          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                            {item.badge}
                          </span>
                        )}
                        {isPinned && <Check className="size-4 shrink-0 text-primary" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
      <LeaveBot />
    </div>
  );
}

// Cache avatar URLs so they're not re-fetched on every navigation
const avatarCache = new Map<string, { url: string; expiresAt: number }>();

function AvatarCircle({ name, userId }: { name?: string; userId?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const cached = avatarCache.get(userId);
    // Use cached URL if it expires more than 10 minutes from now
    if (cached && cached.expiresAt - Date.now() > 10 * 60 * 1000) {
      setSrc(cached.url);
      return;
    }
    supabase.storage.from("avatars").list("", { search: `${userId}.jpg` })
      .then(({ data }) => {
        if (data && data.some((f) => f.name === `${userId}.jpg`)) {
          // 6-hour TTL — long enough for a full day session
          return supabase.storage.from("avatars").createSignedUrl(`${userId}.jpg`, 6 * 3600);
        }
        return null;
      })
      .then((res) => {
        if (res?.data?.signedUrl) {
          avatarCache.set(userId, { url: res.data.signedUrl, expiresAt: Date.now() + 6 * 3600 * 1000 });
          setSrc(res.data.signedUrl);
        }
      })
      .catch(() => {});
  }, [userId]);

  if (src) {
    return <img src={src} alt={name ?? ""} className="size-full object-cover" onError={() => { avatarCache.delete(userId ?? ""); setSrc(null); }} />;
  }
  return <span>{name?.slice(0, 2).toUpperCase()}</span>;
}