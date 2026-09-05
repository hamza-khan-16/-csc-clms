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
  search?: Record<string, unknown>; // optional default search params for routes that require them
};

const BANNER_H = 32; // px — matches py-2 + text-xs line height

function OfflineBanner({ onToggle }: { onToggle: (v: boolean) => void }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const up   = () => { setOffline(false); onToggle(false); };
    const down = () => { setOffline(true);  onToggle(true);  };
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    const initial = !navigator.onLine;
    setOffline(initial);
    onToggle(initial);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []); // eslint-disable-line
  if (!offline) return null;
  return (
    <div
      className="fixed top-0 inset-x-0 z-[200] flex items-center justify-center gap-2 bg-destructive px-4 text-xs font-medium text-destructive-foreground"
      style={{ height: BANNER_H }}
    >
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
  const [offline, setOffline] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // Dark mode — use shared ThemeProvider so login page and app stay in sync
  const { theme, toggle: toggleTheme } = useTheme();
  const dark = theme === "dark";

  // Mobile bottom nav pinned tabs — persisted to Supabase user_metadata
  const [pinnedTabs, setPinnedTabs] = useState<string[]>([]);
  const pinnedTabsLoaded = useRef(false);
  const pinnedTabsDirty  = useRef(false); // true only after user actually changes tabs

  // Load pinned tabs from Supabase session (cached — no network)
  useEffect(() => {
    if (!profile?.id) return;
    supabase.auth.getSession().then(({ data }) => {
      const saved = data?.session?.user?.user_metadata?.pinned_tabs;
      if (Array.isArray(saved)) setPinnedTabs(saved);
      pinnedTabsLoaded.current = true;
    }).catch(() => { pinnedTabsLoaded.current = true; });
  }, [profile?.id]);

  // Sync to Supabase only when the user actually changed the tabs (not on initial load)
  useEffect(() => {
    if (!profile?.id || !pinnedTabsLoaded.current || !pinnedTabsDirty.current) return;
    supabase.auth.updateUser({ data: { pinned_tabs: pinnedTabs } }).catch(() => {});
  }, [pinnedTabs, profile?.id]);

  // Wrap setPinnedTabs so any user-triggered change sets the dirty flag
  function updatePinnedTabs(tabs: string[] | ((prev: string[]) => string[])) {
    pinnedTabsDirty.current = true;
    setPinnedTabs(tabs);
  }

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
    { to: "/leaves",        label: "My Leaves",         icon: FileText,       roles: ["teacher", "hod"], search: { filter: "all" } },
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
    updatePinnedTabs((prev) => {
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
            search={item.search as any}
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
      <OfflineBanner onToggle={setOffline} />
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
        <header
          className="sticky z-20 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-3 backdrop-blur-md shadow-sm sm:gap-3 sm:px-6 sm:py-4"
          style={{ top: offline ? BANNER_H : 0 }}
        >
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
            <div className="size-10 rounded-full overflow-hidden ring-2 ring-border">
              <AvatarCircle name={profile?.full_name} userId={profile?.id} />
            </div>
          </div>
        </header>
        <main className="flex-1 px-3 py-4 pb-20 sm:px-6 sm:py-6 lg:pb-6 page-enter">{children}</main>

        {/* Mobile FAB — Apply Leave shortcut for teachers/HODs only */}
        {(role === "teacher" || role === "hod") && pathname !== "/apply" && (
          <Link
            to="/apply"
            aria-label="Apply for leave"
            className="fixed bottom-20 right-4 z-40 lg:hidden flex items-center justify-center size-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90 active:scale-95 transition-all duration-150"
          >
            <CalendarPlus className="size-6" />
          </Link>
        )}

        {/* Mobile bottom nav — customisable */}
        <nav className="fixed bottom-0 inset-x-0 z-30 flex lg:hidden border-t border-border bg-background/95 backdrop-blur-md pb-safe">
          {mobileNavItems.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                search={item.search as any}
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

// Avatar URL cache — two layers:
//   1. In-memory Map  : instant, lives for the JS lifetime (navigation within SPA)
//   2. sessionStorage : survives hard reloads; cleared when tab closes
const AVATAR_SS_PREFIX = "avatar_url:";
const avatarCache = new Map<string, { url: string; expiresAt: number }>();

function avatarCacheGet(userId: string): { url: string; expiresAt: number } | null {
  const mem = avatarCache.get(userId);
  if (mem && mem.expiresAt - Date.now() > 10 * 60 * 1000) return mem;
  try {
    const raw = sessionStorage.getItem(AVATAR_SS_PREFIX + userId);
    if (raw) {
      const parsed = JSON.parse(raw) as { url: string; expiresAt: number };
      if (parsed.expiresAt - Date.now() > 10 * 60 * 1000) {
        avatarCache.set(userId, parsed); // warm memory layer
        return parsed;
      }
      sessionStorage.removeItem(AVATAR_SS_PREFIX + userId);
    }
  } catch (e) {
    // sessionStorage may be blocked (private mode, quota exceeded) — fail silently
    if (process.env.NODE_ENV === "development") console.warn("[avatar cache]", e);
  }
  return null;
}

function avatarCacheSet(userId: string, url: string, expiresAt: number) {
  const entry = { url, expiresAt };
  avatarCache.set(userId, entry);
  try { sessionStorage.setItem(AVATAR_SS_PREFIX + userId, JSON.stringify(entry)); } catch (e) {
    if (process.env.NODE_ENV === "development") console.warn("[avatar cache set]", e);
  }
}

// Deterministic pastel background per user — hashes userId to one of 12 distinct hues
const AVATAR_PALETTES = [
  { bg: "bg-red-100    dark:bg-red-900/40",    text: "text-red-700    dark:text-red-300" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-amber-100  dark:bg-amber-900/40",  text: "text-amber-700  dark:text-amber-300" },
  { bg: "bg-yellow-100 dark:bg-yellow-900/40", text: "text-yellow-700 dark:text-yellow-300" },
  { bg: "bg-lime-100   dark:bg-lime-900/40",   text: "text-lime-700   dark:text-lime-300" },
  { bg: "bg-green-100  dark:bg-green-900/40",  text: "text-green-700  dark:text-green-300" },
  { bg: "bg-teal-100   dark:bg-teal-900/40",   text: "text-teal-700   dark:text-teal-300" },
  { bg: "bg-cyan-100   dark:bg-cyan-900/40",   text: "text-cyan-700   dark:text-cyan-300" },
  { bg: "bg-sky-100    dark:bg-sky-900/40",    text: "text-sky-700    dark:text-sky-300" },
  { bg: "bg-blue-100   dark:bg-blue-900/40",   text: "text-blue-700   dark:text-blue-300" },
  { bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-pink-100   dark:bg-pink-900/40",   text: "text-pink-700   dark:text-pink-300" },
];

function avatarPalette(userId?: string) {
  if (!userId) return AVATAR_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

function AvatarCircle({ name, userId }: { name?: string; userId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const palette = avatarPalette(userId);

  useEffect(() => {
    if (!userId) return;
    const cached = avatarCacheGet(userId);
    if (cached) { setSrc(cached.url); return; }
    supabase.storage.from("avatars").list("", { search: `${userId}.jpg` })
      .then(({ data }) => {
        if (data && data.some((f) => f.name === `${userId}.jpg`)) {
          return supabase.storage.from("avatars").createSignedUrl(`${userId}.jpg`, 6 * 3600);
        }
        return null;
      })
      .then((res) => {
        if (res?.data?.signedUrl) {
          avatarCacheSet(userId, res.data.signedUrl, Date.now() + 6 * 3600 * 1000);
          setSrc(res.data.signedUrl);
        }
      })
      .catch((e) => {
        if (process.env.NODE_ENV === "development") console.warn("[avatar fetch]", e);
      });
  }, [userId]);

  if (src) {
    return <img src={src} alt={name ?? ""} className="size-full object-cover" onError={() => {
      avatarCache.delete(userId ?? "");
      try { sessionStorage.removeItem(AVATAR_SS_PREFIX + (userId ?? "")); } catch (e) {
        if (process.env.NODE_ENV === "development") console.warn("[avatar cache clear]", e);
      }
      setSrc(null);
    }} />;
  }
  return (
    <span className={cn("grid size-full place-items-center rounded-full text-sm font-bold", palette.bg, palette.text)}>
      {name?.slice(0, 2).toUpperCase()}
    </span>
  );
}