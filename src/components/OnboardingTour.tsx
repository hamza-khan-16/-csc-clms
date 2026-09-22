import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, ChevronRight, ChevronLeft,
  Sparkles, CalendarPlus, ClipboardList,
  CalendarDays, Repeat, Wallet, PartyPopper,
  CheckCircle2, Users, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TOUR_KEY = "onboarding_tour_done_v1";
const SPOTLIGHT_PAD = 8;
const CARD_W = 300;
const CARD_H = 210; // used only for placement math
const MARGIN = 12;
const ARROW_GAP = 36;

interface TourStep {
  title: string;
  body: string;
  Icon: React.ElementType;
  target: string | null; // data-tour attribute value; null = centred welcome/end card
}

const TEACHER_STEPS: TourStep[] = [
  { Icon: Sparkles,      title: "Welcome to CSC LMS!",   body: "This is your Leave Management System. Let's take a quick tour so you know where everything is.", target: null },
  { Icon: CalendarPlus,  title: "Apply for Leave",        body: "Tap 'Apply Leave' to submit casual, medical, duty, maternity, or bereavement leave. Your HOD reviews it first, then the principal.", target: "apply" },
  { Icon: ClipboardList, title: "Track Your Leaves",      body: "Go to 'My Leaves' to see all your leave requests, their approval status, and how many days you've used.", target: "leaves" },
  { Icon: CalendarDays,  title: "Your Schedule",          body: "'My Schedule' shows your weekly timetable. You'll also see proxy duties assigned to you here.", target: "schedule" },
  { Icon: Repeat,        title: "Proxy Duties",           body: "When a colleague is on leave you may be asked to cover their class. Accept or decline here.", target: "proxies" },
  { Icon: Wallet,        title: "Payroll",                body: "Check your monthly salary slip in 'Payroll'. Any unpaid leave deductions are shown clearly.", target: "payroll" },
  { Icon: PartyPopper,   title: "You're all set!",        body: "That's the tour! Tap the chat button any time to ask LeaveBot questions about your leaves or schedule.", target: "leavebot" },
];

const HOD_STEPS: TourStep[] = [
  { Icon: Sparkles,      title: "Welcome, HOD!",    body: "As Head of Department, you manage leave approvals and proxy assignments for your department.", target: null },
  { Icon: CheckCircle2,  title: "Approve Leaves",   body: "Go to 'Leave Requests' to review pending leave applications from your department. You can approve or reject with a note.", target: "requests" },
  { Icon: Users,         title: "Assign Proxies",   body: "When approving a leave, assign proxy teachers for each lecture slot. The app shows you who is free.", target: "proxies" },
  { Icon: BarChart3,     title: "Reports",          body: "'Reports' gives you a full monthly attendance and leave summary for every teacher in your department.", target: "reports" },
  { Icon: PartyPopper,   title: "You're ready!",    body: "Use the LeaveBot any time to ask questions about your team's leaves or schedule.", target: "leavebot" },
];

// ─── geometry ────────────────────────────────────────────────────────────────

interface Box { top: number; left: number; width: number; height: number }
interface Pos  { top: number; left: number }
interface Arrow { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number }

/** Pick the DOM element that is actually visible for the given data-tour value */
function findTarget(key: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`));
  if (!all.length) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  return (
    all.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
    }) ?? all[0]
  );
}

interface Layout {
  spot: Box;          // spotlight rect in viewport coords
  card: Pos;          // card top-left
  cardW: number;
  arrow: Arrow | null;
  side: "top" | "bottom" | "left" | "right" | null;
}

function computeLayout(target: string | null): Layout | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = Math.min(CARD_W, vw - MARGIN * 2);

  if (!target) {
    // Centred welcome / end card — no spotlight, no arrow
    return {
      spot: { top: 0, left: 0, width: 0, height: 0 },
      card: { top: Math.round(vh / 2 - CARD_H / 2), left: Math.round(vw / 2 - cw / 2) },
      cardW: cw,
      arrow: null,
      side: null,
    };
  }

  const el = findTarget(target);
  if (!el) return null;

  const r = el.getBoundingClientRect();
  const spot: Box = {
    top:    r.top    - SPOTLIGHT_PAD,
    left:   r.left   - SPOTLIGHT_PAD,
    width:  r.width  + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  };

  const spCX = spot.left + spot.width  / 2;
  const spCY = spot.top  + spot.height / 2;
  const inBottom = spot.top + spot.height > vh * 0.60;

  // ── try four sides in priority order ──────────────────────────────────────
  type Side = "above" | "below" | "right" | "left";
  const order: Side[] = inBottom
    ? ["above", "left", "right", "below"]
    : ["below", "above", "right", "left"];

  for (const side of order) {
    let cardTop: number, cardLeft: number;
    let fits = false;

    if (side === "below") {
      cardTop  = spot.top + spot.height + ARROW_GAP;
      cardLeft = clamp(spCX - cw / 2, MARGIN, vw - cw - MARGIN);
      fits = cardTop + CARD_H + MARGIN < vh;
    } else if (side === "above") {
      cardTop  = spot.top - ARROW_GAP - CARD_H;
      cardLeft = clamp(spCX - cw / 2, MARGIN, vw - cw - MARGIN);
      fits = cardTop > MARGIN;
      if (!fits && inBottom) { cardTop = MARGIN; fits = true; } // force above on bottom nav
    } else if (side === "right") {
      cardLeft = spot.left + spot.width + ARROW_GAP;
      cardTop  = clamp(spCY - CARD_H / 2, MARGIN, vh - CARD_H - MARGIN);
      fits = cardLeft + cw + MARGIN < vw;
    } else {
      cardLeft = spot.left - ARROW_GAP - cw;
      cardTop  = clamp(spCY - CARD_H / 2, MARGIN, vh - CARD_H - MARGIN);
      fits = cardLeft > MARGIN;
    }

    if (!fits) continue;

    // clamp card into viewport
    cardTop  = clamp(cardTop,  MARGIN, vh - CARD_H - MARGIN);
    cardLeft = clamp(cardLeft, MARGIN, vw - cw    - MARGIN);

    // arrow: from spotlight edge → card edge midpoint
    const cardCX = cardLeft + cw      / 2;
    const cardCY = cardTop  + CARD_H  / 2;
    let x1: number, y1: number, x2: number, y2: number;

    if (side === "below")  { x1 = spCX; y1 = spot.top + spot.height; x2 = cardCX; y2 = cardTop; }
    else if (side === "above") { x1 = spCX; y1 = spot.top;           x2 = cardCX; y2 = cardTop + CARD_H; }
    else if (side === "right") { x1 = spot.left + spot.width; y1 = spCY; x2 = cardLeft;    y2 = cardCY; }
    else                       { x1 = spot.left;              y1 = spCY; x2 = cardLeft + cw; y2 = cardCY; }

    // quadratic bezier control point
    const cpx = (x1 + x2) / 2;
    const cpy = (y1 + y2) / 2;

    return {
      spot,
      card: { top: cardTop, left: cardLeft },
      cardW: cw,
      arrow: { x1, y1, x2, y2, cpx, cpy },
      side: side === "above" ? "bottom" : side === "below" ? "top" : side as "left" | "right",
    };
  }

  // absolute fallback — centre the card
  return {
    spot,
    card: { top: MARGIN, left: Math.round(vw / 2 - cw / 2) },
    cardW: cw,
    arrow: null,
    side: null,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── arrowhead helper ────────────────────────────────────────────────────────

function Arrowhead({ x2, y2, cpx, cpy }: { x2: number; y2: number; cpx: number; cpy: number }) {
  const angle = Math.atan2(y2 - cpy, x2 - cpx);
  const L = 11, spread = 0.45;
  const ax1 = x2 - L * Math.cos(angle - spread);
  const ay1 = y2 - L * Math.sin(angle - spread);
  const ax2 = x2 - L * Math.cos(angle + spread);
  const ay2 = y2 - L * Math.sin(angle + spread);
  return <polygon points={`${ax1},${ay1} ${x2},${y2} ${ax2},${ay2}`} fill="#f97316" />;
}

// ─── component ───────────────────────────────────────────────────────────────

export function OnboardingTour({ role }: { role: string }) {
  const [visible,  setVisible]  = useState(false);
  const [mounted,  setMounted]  = useState(false);
  const [step,     setStep]     = useState(0);
  const [layout,   setLayout]   = useState<Layout | null>(null);
  const [cardKey,  setCardKey]  = useState(0); // bumped each step to re-trigger animation

  const steps   = role === "hod" ? HOD_STEPS : TEACHER_STEPS;
  const current = steps[step];
  const isLast  = step === steps.length - 1;
  const rafRef  = useRef<number | null>(null);

  // ── measure & position ───────────────────────────────────────────────────
  const measure = useCallback(() => {
    setLayout(computeLayout(current.target));
  }, [current.target]);

  // Re-measure whenever the step changes or visibility turns on
  useEffect(() => {
    if (!visible) return;

    // Small delay so the DOM has settled (sidebar links, bottom nav, etc.)
    const t = setTimeout(() => {
      measure();
    }, 60);

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
  }, [visible, measure]); // ← measure is stable per step; re-runs on step change ✓

  useEffect(() => {
    setMounted(true);
    try {
      if (!localStorage.getItem(TOUR_KEY)) setTimeout(() => setVisible(true), 800);
    } catch {
      setTimeout(() => setVisible(true), 800);
    }
  }, []);

  // ── navigation ───────────────────────────────────────────────────────────
  function dismiss() {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* */ }
    setVisible(false);
  }

  function goTo(s: number) {
    setStep(s);
    setCardKey((k) => k + 1); // re-trigger fade animation
  }

  function next() { if (!isLast) goTo(step + 1); else dismiss(); }
  function prev() { if (step > 0) goTo(step - 1); }

  if (!mounted || !visible || !layout) return null;

  const { Icon } = current;
  const { spot, card, cardW, arrow } = layout;
  const hasSpot = !!current.target && spot.width > 0;

  // ── render ───────────────────────────────────────────────────────────────
  return createPortal(
    <>
      {/* ── SVG layer: backdrop + spotlight cutout + arrow ── */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 9990, pointerEvents: "none", overflow: "visible" }}
      >
        <defs>
          <mask id="csc-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasSpot && (
              <rect x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={8} fill="black" />
            )}
          </mask>
        </defs>

        {/* dark overlay */}
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#csc-tour-mask)" />

        {/* orange spotlight border */}
        {hasSpot && (
          <rect
            x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={8}
            fill="none" stroke="#f97316" strokeWidth={2.5}
            style={{ filter: "drop-shadow(0 0 7px rgba(249,115,22,0.85))" }}
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
      <div style={{ position: "fixed", inset: 0, zIndex: 9991, cursor: "default" }} onClick={dismiss} />

      {/* ── Tour card ── */}
      <div
        key={cardKey}
        className="animate-in zoom-in-95 fade-in duration-200"
        style={{
          position: "fixed",
          top:  card.top,
          left: card.left,
          width: cardW,
          zIndex: 9999,
          pointerEvents: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
          {/* header */}
          <div className="bg-primary px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center justify-center size-10 rounded-xl bg-white/20">
                <Icon className="size-5 text-white" />
              </div>
              <button
                onClick={dismiss}
                className="flex items-center justify-center size-6 rounded-full border-2 border-white/60 text-white hover:bg-white/20 transition-colors shrink-0 mt-0.5"
                aria-label="Close tour"
              >
                <X className="size-3" />
              </button>
            </div>
            <h2 className="mt-2.5 text-base font-bold text-white leading-snug">{current.title}</h2>
          </div>

          {/* body */}
          <div className="px-5 pt-3 pb-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{current.body}</p>

            {/* progress dots */}
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/25"
                  }`}
                />
              ))}
            </div>

            {/* nav */}
            <div className="flex items-center justify-between gap-3 pt-0.5">
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
                  {isLast ? "Get started!" : "Next"} {!isLast && <ChevronRight className="size-3" />}
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
