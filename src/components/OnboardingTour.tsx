/**
 * OnboardingTour
 *
 * Desktop: spotlights the sidebar nav links one by one.
 * Mobile:  spotlights every item in the bottom navbar (even ones not pinned —
 *          during onboarding we show ALL role-visible items sequentially so the
 *          user understands everything available to them).
 *
 * TESTING MODE: shows on every login. To switch to prod mode, replace the
 * `setTimeout(() => setVisible(true), 800)` in the mount effect with:
 *   if (!localStorage.getItem(TOUR_KEY)) setTimeout(() => setVisible(true), 800);
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, ChevronRight, ChevronLeft, Sparkles, PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TOUR_KEY = "onboarding_tour_done_v3";
const SPOTLIGHT_PAD = 8;
const CARD_W = 300;
const CARD_H = 200; // used only for placement math
const MARGIN  = 12;
const ARROW_GAP = 32;

// ─── types ───────────────────────────────────────────────────────────────────

interface NavItemMini { to: string; label: string }

interface Props {
  role: string;
  /** Every nav item the user's role can see (for sidebar on desktop) */
  allNavItems: NavItemMini[];
  /** The 5 items currently shown in the mobile bottom nav */
  mobileNavItems: NavItemMini[];
}

// ─── geometry ────────────────────────────────────────────────────────────────

interface Box { top: number; left: number; width: number; height: number }
interface Arrow { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number }
interface Layout { spot: Box; card: { top: number; left: number }; cardW: number; arrow: Arrow | null }

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** Return the DOM element for `data-tour` that is actually painted on screen */
function findVisible(tourKey: string): HTMLElement | null {
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${tourKey}"]`));
  return (
    all.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
    }) ?? all[0] ?? null
  );
}

function computeLayout(tourKey: string | null): Layout | null {
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = Math.min(CARD_W, vw - MARGIN * 2);

  if (!tourKey) {
    return {
      spot:  { top: 0, left: 0, width: 0, height: 0 },
      card:  { top: Math.round(vh / 2 - CARD_H / 2), left: Math.round(vw / 2 - cw / 2) },
      cardW: cw,
      arrow: null,
    };
  }

  const el = findVisible(tourKey);
  if (!el) return null;

  const r  = el.getBoundingClientRect();
  const spot: Box = {
    top:    r.top    - SPOTLIGHT_PAD,
    left:   r.left   - SPOTLIGHT_PAD,
    width:  r.width  + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  };

  const spCX = spot.left + spot.width  / 2;
  const spCY = spot.top  + spot.height / 2;
  // If the element is in the bottom 40% of the viewport, prefer placing card above
  const nearBottom = spot.top + spot.height > vh * 0.60;

  type Side = "above" | "below" | "right" | "left";
  const order: Side[] = nearBottom
    ? ["above", "left", "right", "below"]
    : ["below", "above", "right",  "left"];

  for (const side of order) {
    let cardTop: number, cardLeft: number, fits = false;

    if (side === "above") {
      cardTop  = spot.top - ARROW_GAP - CARD_H;
      cardLeft = clamp(spCX - cw / 2, MARGIN, vw - cw - MARGIN);
      fits     = cardTop > MARGIN;
      // Force above for bottom-nav items even if tight
      if (!fits && nearBottom) { cardTop = MARGIN; fits = true; }
    } else if (side === "below") {
      cardTop  = spot.top + spot.height + ARROW_GAP;
      cardLeft = clamp(spCX - cw / 2, MARGIN, vw - cw - MARGIN);
      fits     = cardTop + CARD_H + MARGIN < vh;
    } else if (side === "right") {
      cardLeft = spot.left + spot.width + ARROW_GAP;
      cardTop  = clamp(spCY - CARD_H / 2, MARGIN, vh - CARD_H - MARGIN);
      fits     = cardLeft + cw + MARGIN < vw;
    } else {
      cardLeft = spot.left - ARROW_GAP - cw;
      cardTop  = clamp(spCY - CARD_H / 2, MARGIN, vh - CARD_H - MARGIN);
      fits     = cardLeft > MARGIN;
    }

    if (!fits) continue;

    cardTop  = clamp(cardTop,  MARGIN, vh - CARD_H - MARGIN);
    cardLeft = clamp(cardLeft, MARGIN, vw - cw    - MARGIN);

    const cardCX = cardLeft + cw     / 2;
    const cardCY = cardTop  + CARD_H / 2;
    let x1: number, y1: number, x2: number, y2: number;

    if      (side === "above") { x1 = spCX; y1 = spot.top;               x2 = cardCX; y2 = cardTop + CARD_H; }
    else if (side === "below") { x1 = spCX; y1 = spot.top + spot.height; x2 = cardCX; y2 = cardTop; }
    else if (side === "right") { x1 = spot.left + spot.width; y1 = spCY; x2 = cardLeft;      y2 = cardCY; }
    else                       { x1 = spot.left;              y1 = spCY; x2 = cardLeft + cw;  y2 = cardCY; }

    return {
      spot,
      card: { top: cardTop, left: cardLeft },
      cardW: cw,
      arrow: { x1, y1, x2, y2, cpx: (x1 + x2) / 2, cpy: (y1 + y2) / 2 },
    };
  }

  // Fallback: centred card, no arrow
  return {
    spot,
    card: { top: MARGIN, left: Math.round(vw / 2 - cw / 2) },
    cardW: cw,
    arrow: null,
  };
}

// ─── arrowhead ───────────────────────────────────────────────────────────────

function Arrowhead({ x2, y2, cpx, cpy }: { x2: number; y2: number; cpx: number; cpy: number }) {
  const angle   = Math.atan2(y2 - cpy, x2 - cpx);
  const L = 12, spread = 0.42;
  const ax1 = x2 - L * Math.cos(angle - spread);
  const ay1 = y2 - L * Math.sin(angle - spread);
  const ax2 = x2 - L * Math.cos(angle + spread);
  const ay2 = y2 - L * Math.sin(angle + spread);
  return <polygon points={`${ax1},${ay1} ${x2},${y2} ${ax2},${ay2}`} fill="#f97316" />;
}

// ─── build step list from nav items ──────────────────────────────────────────

interface TourStep {
  tourKey: string | null; // data-tour value to spotlight
  title: string;
  body: string;
}

function buildSteps(
  role: string,
  allNavItems: NavItemMini[],
  mobileNavItems: NavItemMini[],
  isMobile: boolean,
): TourStep[] {
  const steps: TourStep[] = [
    {
      tourKey: null,
      title: role === "hod" ? "Welcome, HOD!" : "Welcome to CSC LMS!",
      body:  role === "hod"
        ? "As Head of Department you manage leave approvals and proxy assignments. Let's walk through the app."
        : "This is your Leave Management System. Let's take a quick tour so you know where everything is.",
    },
  ];

  // On mobile: walk through ALL role-visible items so the user sees everything,
  // even items not currently pinned to the bottom bar.
  // On desktop: walk through the sidebar items.
  const navToShow = isMobile ? allNavItems : allNavItems;

  const descriptions: Record<string, string> = {
    dashboard: "Your home screen — leave balance, attendance calendar, upcoming schedule and quick stats at a glance.",
    apply:     "Submit casual, medical, duty, maternity, or bereavement leave. Your HOD reviews it first, then the principal.",
    leaves:    "Track all your leave requests, their approval status, and how many days you've used this year.",
    schedule:  "Your weekly timetable. Proxy duties assigned to you also appear here.",
    proxies:   "When a colleague is on leave you may be asked to cover their class. Accept or decline here.",
    payroll:   "Your monthly salary slip. Any unpaid leave deductions are clearly itemised.",
    requests:  "Review and approve or reject leave applications from your department.",
    reports:   "Monthly attendance and leave summary for every teacher in your department. Export as PDF or Excel.",
    holidays:  "Official college holidays and the academic calendar for the year.",
    profile:   "Update your personal details, change your password, and manage notification settings.",
    notices:   "College-wide announcements and circulars from the principal's office.",
    teachers:  "Directory of all teachers — contact info, department, and leave history.",
    departments: "Manage department structure and assign heads of department.",
    admin:     "Full system administration — user management, roles, and system settings.",
    hr:        "HR panel — staff onboarding, payroll management, and employment records.",
    "admin-reports": "System-wide reports and analytics across all departments.",
  };

  for (const item of navToShow) {
    const key = item.to.replace("/", "") || "dashboard";
    steps.push({
      tourKey: key,
      title:   item.label,
      body:    descriptions[key] ?? `Navigate to ${item.label} using this menu item.`,
    });
  }

  // On mobile, also highlight that they can customise the bottom bar
  if (isMobile) {
    steps.push({
      tourKey: null,
      title:   "Customise your bottom bar",
      body:    "Tap the ⊕ button at the right end of the bottom nav to pin your favourite 5 items for quick access.",
    });
  }

  steps.push({
    tourKey: "leavebot",
    title:   "Need help?",
    body:    "Tap the chat button any time to ask LeaveBot questions about your leaves, schedule, or anything else.",
  });

  steps.push({
    tourKey: null,
    title:   "You're all set! 🎉",
    body:    "That's everything. You can revisit any section using the menu. Have a great semester!",
  });

  return steps;
}

// ─── component ───────────────────────────────────────────────────────────────

export function OnboardingTour({ role, allNavItems, mobileNavItems }: Props) {
  const [visible,   setVisible]   = useState(false);
  const [mounted,   setMounted]   = useState(false);
  const [step,      setStep]      = useState(0);
  const [layout,    setLayout]    = useState<Layout | null>(null);
  const [cardKey,   setCardKey]   = useState(0);
  const [isMobile,  setIsMobile]  = useState(false);
  const rafRef = useRef<number | null>(null);

  // Detect mobile (< lg breakpoint = 1024px)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const steps = buildSteps(role, allNavItems, mobileNavItems, isMobile);
  const current = steps[step];
  const isLast  = step === steps.length - 1;

  // ── measure ──────────────────────────────────────────────────────────────
  const measure = useCallback(() => {
    setLayout(computeLayout(current.tourKey));
  }, [current.tourKey]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(measure, 80);
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, measure]);

  // ── mount — TESTING MODE: always show ────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    // TESTING MODE: shows every login.
    // For production swap this line with:
    //   if (!localStorage.getItem(TOUR_KEY)) setTimeout(() => setVisible(true), 800);
    setTimeout(() => setVisible(true), 800);
  }, []);

  // ── navigation ───────────────────────────────────────────────────────────
  function dismiss() {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /**/ }
    setVisible(false);
  }

  function goTo(s: number) {
    setStep(s);
    setLayout(null); // clear old layout instantly so card snaps to new position
    setCardKey((k) => k + 1);
  }

  function next() { if (!isLast) goTo(step + 1); else dismiss(); }
  function prev() { if (step > 0) goTo(step - 1); }

  if (!mounted || !visible) return null;

  // Fallback centred card while measuring
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = Math.min(CARD_W, vw - MARGIN * 2);
  const activeLayout: Layout = layout ?? {
    spot:  { top: 0, left: 0, width: 0, height: 0 },
    card:  { top: Math.round(vh / 2 - CARD_H / 2), left: Math.round(vw / 2 - cw / 2) },
    cardW: cw,
    arrow: null,
  };

  const { spot, card, cardW, arrow } = activeLayout;
  const hasSpot = !!current.tourKey && layout !== null && spot.width > 0;

  return createPortal(
    <>
      {/* SVG: dark overlay + spotlight cutout + dashed arrow */}
      <svg style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 9990, pointerEvents: "none", overflow: "visible" }}>
        <defs>
          <mask id="csc-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasSpot && <rect x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={8} fill="black" />}
          </mask>
        </defs>

        <rect width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#csc-tour-mask)" />

        {hasSpot && (
          <rect
            x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={8}
            fill="none" stroke="#f97316" strokeWidth={2.5}
            style={{ filter: "drop-shadow(0 0 8px rgba(249,115,22,0.9))" }}
          />
        )}

        {arrow && (
          <g>
            <path
              d={`M ${arrow.x1} ${arrow.y1} Q ${arrow.cpx} ${arrow.cpy} ${arrow.x2} ${arrow.y2}`}
              stroke="#f97316" strokeWidth={2} fill="none" strokeDasharray="6 4"
            />
            <Arrowhead x2={arrow.x2} y2={arrow.y2} cpx={arrow.cpx} cpy={arrow.cpy} />
          </g>
        )}
      </svg>

      {/* click-outside dismisses */}
      <div style={{ position: "fixed", inset: 0, zIndex: 9991, cursor: "default" }} onClick={dismiss} />

      {/* Tour card */}
      <div
        key={cardKey}
        className="animate-in zoom-in-95 fade-in duration-200"
        style={{ position: "fixed", top: card.top, left: card.left, width: cardW, zIndex: 9999, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
          {/* header */}
          <div className="bg-primary px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center justify-center size-9 rounded-xl bg-white/20">
                {isLast
                  ? <PartyPopper className="size-4 text-white" />
                  : <Sparkles    className="size-4 text-white" />
                }
              </div>
              <button
                onClick={dismiss}
                className="flex items-center justify-center size-6 rounded-full border-2 border-white/60 text-white hover:bg-white/20 transition-colors shrink-0 mt-0.5"
                aria-label="Close tour"
              >
                <X className="size-3" />
              </button>
            </div>
            <h2 className="mt-2.5 text-sm font-bold text-white leading-snug">{current.title}</h2>
          </div>

          {/* body */}
          <div className="px-5 pt-3 pb-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{current.body}</p>

            {/* progress: step N of total */}
            <div className="flex items-center gap-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i === step
                      ? "bg-primary flex-[2]"
                      : i < step
                      ? "bg-primary/40 flex-1"
                      : "bg-muted-foreground/20 flex-1"
                  }`}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60">{step + 1} of {steps.length}</p>

            {/* nav buttons */}
            <div className="flex items-center justify-between gap-3">
              <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Skip tour
              </button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2.5" onClick={prev}>
                    <ChevronLeft className="size-3" /> Back
                  </Button>
                )}
                <Button size="sm" className="h-7 text-xs gap-1 px-2.5" onClick={next}>
                  {isLast ? "Done!" : "Next"}{!isLast && <ChevronRight className="size-3" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
