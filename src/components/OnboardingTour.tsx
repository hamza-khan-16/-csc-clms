/**
 * OnboardingTour
 * - Desktop: spotlights sidebar nav links
 * - Mobile:  spotlights only the items in the current bottom navbar (max 5)
 * - Steps are built once on mount from the real nav data
 * - TESTING MODE: shows on every login
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, ChevronLeft, Sparkles, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";

const TOUR_KEY     = "onboarding_tour_done_v3";
const SPOTLIGHT_PAD = 8;
const CARD_W       = 300;
const CARD_H       = 200;   // used only for placement math
const MARGIN       = 12;
const ARROW_GAP    = 32;

// ─── types ───────────────────────────────────────────────────────────────────

interface NavItemMini { to: string; label: string }

interface Props {
  role: string;
  allNavItems: NavItemMini[];
  mobileNavItems: NavItemMini[];
}

interface Box    { top: number; left: number; width: number; height: number }
interface Arrow  { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number }
interface Layout { spot: Box; card: { top: number; left: number }; cardW: number; arrow: Arrow | null }

interface TourStep { tourKey: string | null; title: string; body: string }

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function isMobileViewport() { return window.innerWidth < 1024; }

function findVisible(key: string): HTMLElement | null {
  const vw = window.innerWidth, vh = window.innerHeight;
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`));
  return (
    els.find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
    }) ?? els[0] ?? null
  );
}

function computeLayout(tourKey: string | null): Layout {
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = Math.min(CARD_W, vw - MARGIN * 2);
  const centred: Layout = {
    spot:  { top: 0, left: 0, width: 0, height: 0 },
    card:  { top: Math.round(vh / 2 - CARD_H / 2), left: Math.round(vw / 2 - cw / 2) },
    cardW: cw, arrow: null,
  };

  if (!tourKey) return centred;

  const el = findVisible(tourKey);
  if (!el) return centred;

  const r    = el.getBoundingClientRect();
  const spot: Box = {
    top:    r.top    - SPOTLIGHT_PAD,
    left:   r.left   - SPOTLIGHT_PAD,
    width:  r.width  + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  };
  const spCX = spot.left + spot.width  / 2;
  const spCY = spot.top  + spot.height / 2;
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

    if      (side === "above") { x1 = spCX; y1 = spot.top;               x2 = cardCX;     y2 = cardTop + CARD_H; }
    else if (side === "below") { x1 = spCX; y1 = spot.top + spot.height; x2 = cardCX;     y2 = cardTop; }
    else if (side === "right") { x1 = spot.left + spot.width; y1 = spCY; x2 = cardLeft;   y2 = cardCY; }
    else                       { x1 = spot.left;              y1 = spCY; x2 = cardLeft+cw; y2 = cardCY; }

    return {
      spot, cardW: cw,
      card:  { top: cardTop, left: cardLeft },
      arrow: { x1, y1, x2, y2, cpx: (x1 + x2) / 2, cpy: (y1 + y2) / 2 },
    };
  }

  return { spot, card: { top: MARGIN, left: Math.round(vw / 2 - cw / 2) }, cardW: cw, arrow: null };
}

// ─── step builder ────────────────────────────────────────────────────────────

const NAV_DESCRIPTIONS: Record<string, string> = {
  dashboard:     "Your home screen — leave balance, attendance calendar, upcoming schedule and quick stats at a glance.",
  apply:         "Submit casual, medical, duty, maternity, or bereavement leave. Your HOD reviews it first, then the principal.",
  leaves:        "Track all your leave requests, their approval status, and how many days you've used this year.",
  schedule:      "Your weekly timetable. Proxy duties assigned to you also appear here.",
  proxies:       "When a colleague is on leave you may be asked to cover their class. Accept or decline here.",
  payroll:       "Your monthly salary slip. Any unpaid leave deductions are clearly itemised.",
  requests:      "Review and approve or reject leave applications from your department.",
  reports:       "Monthly attendance and leave summary for every teacher in your department. Export as PDF or Excel.",
  "admin-reports":"System-wide reports and analytics across all departments.",
  holidays:      "Official college holidays and the academic calendar for the year.",
  profile:       "Update your personal details, change your password, and manage notification preferences.",
  notices:       "College-wide announcements and circulars from the principal's office.",
  teachers:      "Directory of all teachers — contact info, department, and leave history.",
  departments:   "Manage department structure and assign heads of department.",
  admin:         "Full system administration — user management, roles, and system settings.",
  hr:            "HR panel — staff onboarding, payroll management, and employment records.",
};

function buildSteps(
  role: string,
  allNavItems: NavItemMini[],
  mobileNavItems: NavItemMini[],
  mobile: boolean,
): TourStep[] {
  const steps: TourStep[] = [];

  // Welcome
  steps.push({
    tourKey: null,
    title: role === "hod" ? "Welcome, HOD!" : "Welcome to CSC LMS!",
    body:  role === "hod"
      ? "As Head of Department you manage leave approvals and proxy assignments. Let's walk through the app."
      : "This is your Leave Management System. Let's take a quick tour so you know where everything is.",
  });

  // On mobile: only the items currently in the bottom navbar
  // On desktop: all sidebar items
  const items = mobile ? mobileNavItems : allNavItems;

  for (const item of items) {
    const key = item.to.replace("/", "") || "dashboard";
    steps.push({
      tourKey: key,
      title:   item.label,
      body:    NAV_DESCRIPTIONS[key] ?? `Use this section for ${item.label}.`,
    });
  }

  // LeaveBot
  steps.push({
    tourKey: "leavebot",
    title:   "Need help?",
    body:    "Tap the chat button any time to ask LeaveBot about your leaves, schedule, or anything else.",
  });

  // Done
  steps.push({
    tourKey: null,
    title:   "You're all set! 🎉",
    body:    "That's everything. You can revisit any section from the menu. Have a great semester!",
  });

  return steps;
}

// ─── arrowhead ───────────────────────────────────────────────────────────────

function Arrowhead({ x2, y2, cpx, cpy }: { x2: number; y2: number; cpx: number; cpy: number }) {
  const angle = Math.atan2(y2 - cpy, x2 - cpx);
  const L = 12, s = 0.42;
  return (
    <polygon
      fill="#f97316"
      points={`
        ${x2 - L * Math.cos(angle - s)},${y2 - L * Math.sin(angle - s)}
        ${x2},${y2}
        ${x2 - L * Math.cos(angle + s)},${y2 - L * Math.sin(angle + s)}
      `}
    />
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function OnboardingTour({ role, allNavItems, mobileNavItems }: Props) {
  const [visible,  setVisible]  = useState(false);
  const [mounted,  setMounted]  = useState(false);
  const [mobile,   setMobile]   = useState(() =>
    typeof window !== "undefined" ? isMobileViewport() : false
  );
  const [step,     setStep]     = useState(0);
  // layout starts as null; we show centred card immediately and snap once measured
  const [layout,   setLayout]   = useState<Layout | null>(null);
  const [cardKey,  setCardKey]  = useState(0);
  const rafRef = useRef<number | null>(null);

  // Build steps once based on mobile flag + nav items.
  // Re-build only if mobile flag or nav items change — NOT on every step change.
  const steps = useMemo(
    () => buildSteps(role, allNavItems, mobileNavItems, mobile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, mobile,
      // stable identity check via JSON (nav items rarely change)
      JSON.stringify(allNavItems), JSON.stringify(mobileNavItems)],
  );

  // Clamp step into valid range whenever steps array changes length
  // (e.g. mobile ↔ desktop switch mid-tour)
  useEffect(() => {
    setStep(s => Math.min(s, steps.length - 1));
  }, [steps.length]);

  const current = steps[Math.min(step, steps.length - 1)];

  // ── measure ──────────────────────────────────────────────────────────────
  const measure = useCallback(() => {
    if (!current) return;
    setLayout(computeLayout(current.tourKey));
  }, [current?.tourKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible) return;
    // Measure immediately (without clearing layout first to avoid centre-flash)
    const t = setTimeout(measure, 60);
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

  // ── mobile detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setMobile(isMobileViewport());
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // ── mount — TESTING MODE ─────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    // TESTING MODE: always show. For production replace with:
    //   if (!localStorage.getItem(TOUR_KEY)) setTimeout(() => setVisible(true), 800);
    setTimeout(() => setVisible(true), 800);
  }, []);

  // ── navigation ───────────────────────────────────────────────────────────
  function dismiss() {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /**/ }
    setVisible(false);
  }

  function goTo(s: number) {
    // Don't clear layout — compute new layout immediately so the card
    // transitions directly from old position to new (no centre flash)
    const next = steps[s];
    if (next) setLayout(computeLayout(next.tourKey));
    setStep(s);
    setCardKey(k => k + 1);
  }

  function next() { if (step < steps.length - 1) goTo(step + 1); else dismiss(); }
  function prev() { if (step > 0) goTo(step - 1); }

  if (!mounted || !visible || !current) return null;

  // Use measured layout or centred fallback (only on very first render)
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = Math.min(CARD_W, vw - MARGIN * 2);
  const activeLayout: Layout = layout ?? {
    spot:  { top: 0, left: 0, width: 0, height: 0 },
    card:  { top: Math.round(vh / 2 - CARD_H / 2), left: Math.round(vw / 2 - cw / 2) },
    cardW: cw,
    arrow: null,
  };

  const { spot, card, cardW, arrow } = activeLayout;
  const hasSpot = !!current.tourKey && layout !== null && spot.width > 0;
  const isLast  = step === steps.length - 1;

  return createPortal(
    <>
      {/* ── SVG overlay ── */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%",
                 zIndex: 9990, pointerEvents: "none", overflow: "visible" }}
      >
        <defs>
          <mask id="csc-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasSpot && (
              <rect x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={8} fill="black" />
            )}
          </mask>
        </defs>

        {/* dark backdrop */}
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#csc-tour-mask)" />

        {/* orange spotlight ring */}
        {hasSpot && (
          <rect
            x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={8}
            fill="none" stroke="#f97316" strokeWidth={2.5}
            style={{ filter: "drop-shadow(0 0 8px rgba(249,115,22,0.9))" }}
          />
        )}

        {/* dashed arrow */}
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

      {/* click-outside to dismiss */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9991, cursor: "default" }}
        onClick={dismiss}
      />

      {/* ── Tour card ── */}
      <div
        key={cardKey}
        className="animate-in zoom-in-95 fade-in duration-150"
        style={{
          position: "fixed",
          top:  card.top,
          left: card.left,
          width: cardW,
          zIndex: 9999,
          pointerEvents: "auto",
          transition: "top 0.2s ease, left 0.2s ease",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
          {/* header */}
          <div className="bg-primary px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center justify-center size-9 rounded-xl bg-white/20">
                {isLast
                  ? <PartyPopper className="size-4 text-white" />
                  : <Sparkles    className="size-4 text-white" />}
              </div>
              <button
                onClick={dismiss}
                className="flex items-center justify-center size-6 rounded-full border-2 border-white/60 text-white hover:bg-white/20 transition-colors shrink-0 mt-0.5"
                aria-label="Close tour"
              >
                <X className="size-3" />
              </button>
            </div>
            <h2 className="mt-2 text-sm font-bold text-white leading-snug">{current.title}</h2>
          </div>

          {/* body */}
          <div className="px-5 pt-3 pb-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{current.body}</p>

            {/* progress bar */}
            <div className="flex items-center gap-0.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-200 ${
                    i === step   ? "bg-primary flex-[3]"
                    : i < step   ? "bg-primary/40 flex-1"
                                 : "bg-muted-foreground/20 flex-1"
                  }`}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/50 -mt-1">{step + 1} / {steps.length}</p>

            {/* nav */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip
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
