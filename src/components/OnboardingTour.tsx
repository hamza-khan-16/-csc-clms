import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, ChevronRight, ChevronLeft,
  Sparkles, CalendarPlus, ClipboardList,
  CalendarDays, Repeat, Wallet, PartyPopper,
  CheckCircle2, Users, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TOUR_KEY = "onboarding_tour_done_v1";

// Padding around the highlighted element (px)
const SPOTLIGHT_PAD = 8;

interface TourStep {
  title: string;
  body: string;
  Icon: React.ElementType;
  /** data-tour value of the element to spotlight. null = no spotlight (welcome/end) */
  target: string | null;
}

const TEACHER_STEPS: TourStep[] = [
  {
    Icon: Sparkles,
    title: "Welcome to CSC LMS!",
    body: "This is your Leave Management System. Let's take a quick tour so you know where everything is.",
    target: null,
  },
  {
    Icon: CalendarPlus,
    title: "Apply for Leave",
    body: "Tap 'Apply Leave' to submit casual, medical, duty, maternity, or bereavement leave. Your HOD reviews it first, then the principal.",
    target: "apply",
  },
  {
    Icon: ClipboardList,
    title: "Track Your Leaves",
    body: "Go to 'My Leaves' to see all your leave requests, their approval status, and how many days you've used.",
    target: "leaves",
  },
  {
    Icon: CalendarDays,
    title: "Your Schedule",
    body: "'My Schedule' shows your weekly timetable. You'll also see proxy duties assigned to you here.",
    target: "schedule",
  },
  {
    Icon: Repeat,
    title: "Proxy Duties",
    body: "When a colleague is on leave, you may be asked to cover their class. Accept or decline here. You can also offer compensation.",
    target: "proxies",
  },
  {
    Icon: Wallet,
    title: "Payroll",
    body: "Check your monthly salary slip in 'Payroll'. Any unpaid leave deductions are shown clearly.",
    target: "payroll",
  },
  {
    Icon: PartyPopper,
    title: "You're all set!",
    body: "That's the tour! Tap the chat button any time to ask LeaveBot questions about your leaves or schedule.",
    target: "leavebot",
  },
];

const HOD_STEPS: TourStep[] = [
  {
    Icon: Sparkles,
    title: "Welcome, HOD!",
    body: "As Head of Department, you manage leave approvals and proxy assignments for your department.",
    target: null,
  },
  {
    Icon: CheckCircle2,
    title: "Approve Leaves",
    body: "Go to 'Leave Requests' to review pending leave applications from your department. You can approve or reject with a note.",
    target: "requests",
  },
  {
    Icon: Users,
    title: "Assign Proxies",
    body: "When approving a leave, assign proxy teachers for each lecture slot. The app shows you who is free.",
    target: "proxies",
  },
  {
    Icon: BarChart3,
    title: "Reports",
    body: "'Reports' gives you a full monthly attendance and leave summary for every teacher in your department.",
    target: "reports",
  },
  {
    Icon: PartyPopper,
    title: "You're ready!",
    body: "Use the LeaveBot any time to ask questions about your team's leaves or schedule.",
    target: "leavebot",
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface CardPlacement {
  top: number;
  left: number;
  arrowFrom: { x: number; y: number };
  arrowTo: { x: number; y: number };
  arrowSide: "top" | "bottom" | "left" | "right" | null;
}

const CARD_W = 320;
const CARD_H = 220; // approximate; we'll use this for placement math

function computePlacement(
  spot: SpotlightRect,
  vw: number,
  vh: number,
): CardPlacement {
  const margin = 16;
  const arrowLen = 48;

  // Try: below, above, right, left of spotlight
  const spCX = spot.left + spot.width / 2;
  const spCY = spot.top + spot.height / 2;

  // below
  if (spot.top + spot.height + arrowLen + CARD_H + margin < vh) {
    const cardTop = spot.top + spot.height + arrowLen;
    const cardLeft = Math.min(Math.max(spCX - CARD_W / 2, margin), vw - CARD_W - margin);
    const cardCX = cardLeft + CARD_W / 2;
    return {
      top: cardTop, left: cardLeft,
      arrowFrom: { x: spCX, y: spot.top + spot.height + SPOTLIGHT_PAD },
      arrowTo: { x: cardCX, y: cardTop - 4 },
      arrowSide: "top",
    };
  }
  // above
  if (spot.top - arrowLen - CARD_H - margin > 0) {
    const cardTop = spot.top - arrowLen - CARD_H;
    const cardLeft = Math.min(Math.max(spCX - CARD_W / 2, margin), vw - CARD_W - margin);
    const cardCX = cardLeft + CARD_W / 2;
    return {
      top: cardTop, left: cardLeft,
      arrowFrom: { x: spCX, y: spot.top - SPOTLIGHT_PAD },
      arrowTo: { x: cardCX, y: cardTop + CARD_H + 4 },
      arrowSide: "bottom",
    };
  }
  // right
  if (spot.left + spot.width + arrowLen + CARD_W + margin < vw) {
    const cardLeft = spot.left + spot.width + arrowLen;
    const cardTop = Math.min(Math.max(spCY - CARD_H / 2, margin), vh - CARD_H - margin);
    const cardCY = cardTop + CARD_H / 2;
    return {
      top: cardTop, left: cardLeft,
      arrowFrom: { x: spot.left + spot.width + SPOTLIGHT_PAD, y: spCY },
      arrowTo: { x: cardLeft - 4, y: cardCY },
      arrowSide: "left",
    };
  }
  // left
  {
    const cardLeft = spot.left - arrowLen - CARD_W;
    const safeLeft = Math.max(cardLeft, margin);
    const cardTop = Math.min(Math.max(spCY - CARD_H / 2, margin), vh - CARD_H - margin);
    const cardCY = cardTop + CARD_H / 2;
    return {
      top: cardTop, left: safeLeft,
      arrowFrom: { x: spot.left - SPOTLIGHT_PAD, y: spCY },
      arrowTo: { x: safeLeft + CARD_W + 4, y: cardCY },
      arrowSide: "right",
    };
  }
}

interface Props {
  role: "teacher" | "hod" | string;
}

export function OnboardingTour({ role }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [placement, setPlacement] = useState<CardPlacement | null>(null);
  const rafRef = useRef<number | null>(null);

  const steps = role === "hod" ? HOD_STEPS : TEACHER_STEPS;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  // Measure target element and compute card placement
  const measure = useCallback(() => {
    if (!current.target) {
      setSpotlight(null);
      setPlacement(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    if (!el) {
      setSpotlight(null);
      setPlacement(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = SPOTLIGHT_PAD;
    const spot: SpotlightRect = {
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
    setSpotlight(spot);
    setPlacement(computePlacement(spot, vw, vh));
  }, [current.target]);

  useEffect(() => {
    setMounted(true);
    setTimeout(() => setVisible(true), 1200);
    // Restore localStorage check for production:
    // try {
    //   if (!localStorage.getItem(TOUR_KEY)) setTimeout(() => setVisible(true), 1200);
    // } catch (_) {}
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    measure();
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, measure]);

  function dismiss() {
    try { localStorage.setItem(TOUR_KEY, "1"); } catch (_) {}
    setVisible(false);
  }

  function next() {
    if (step < steps.length - 1) setStep((s) => s + 1);
    else dismiss();
  }

  function prev() {
    setStep((s) => Math.max(0, s - 1));
  }

  if (!mounted || !visible) return null;

  const { Icon } = current;
  const vw = typeof window !== "undefined" ? window.innerWidth : 375;
  const vh = typeof window !== "undefined" ? window.innerHeight : 812;

  // Where to put card when there's no spotlight (welcome/end steps)
  const centeredCard: CardPlacement = {
    top: vh / 2 - CARD_H / 2,
    left: Math.max(16, vw / 2 - CARD_W / 2),
    arrowFrom: { x: 0, y: 0 },
    arrowTo: { x: 0, y: 0 },
    arrowSide: null,
  };

  const cardPos = spotlight && placement ? placement : centeredCard;

  return createPortal(
    <>
      {/* ── Overlay with spotlight cutout ── */}
      <svg
        style={{
          position: "fixed", inset: 0,
          width: "100vw", height: "100vh",
          zIndex: 9990, pointerEvents: "none",
        }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            {/* White = visible overlay */}
            <rect width="100%" height="100%" fill="white" />
            {/* Black = cutout (the spotlight) */}
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Dark backdrop with cutout */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tour-spotlight-mask)"
        />

        {/* Orange spotlight border */}
        {spotlight && (
          <rect
            x={spotlight.left}
            y={spotlight.top}
            width={spotlight.width}
            height={spotlight.height}
            rx={10}
            fill="none"
            stroke="#f97316"
            strokeWidth={2.5}
            strokeDasharray="0"
            style={{
              filter: "drop-shadow(0 0 6px rgba(249,115,22,0.8))",
            }}
          />
        )}

        {/* Arrow from spotlight to card */}
        {spotlight && placement && placement.arrowSide && (() => {
          const { arrowFrom, arrowTo } = placement;
          const dx = arrowTo.x - arrowFrom.x;
          const dy = arrowTo.y - arrowFrom.y;
          // Control point: bend midway
          const cpx = arrowFrom.x + dx * 0.5;
          const cpy = arrowFrom.y + dy * 0.5;

          // Arrowhead at the "to" end
          const angle = Math.atan2(arrowTo.y - cpy, arrowTo.x - cpx);
          const ahLen = 10;
          const ahSpread = 0.4;
          const ax1 = arrowTo.x - ahLen * Math.cos(angle - ahSpread);
          const ay1 = arrowTo.y - ahLen * Math.sin(angle - ahSpread);
          const ax2 = arrowTo.x - ahLen * Math.cos(angle + ahSpread);
          const ay2 = arrowTo.y - ahLen * Math.sin(angle + ahSpread);

          return (
            <g stroke="#f97316" strokeWidth={2} fill="none">
              <path
                d={`M ${arrowFrom.x} ${arrowFrom.y} Q ${cpx} ${cpy} ${arrowTo.x} ${arrowTo.y}`}
                strokeDasharray="6 4"
              />
              <path
                d={`M ${ax1} ${ay1} L ${arrowTo.x} ${arrowTo.y} L ${ax2} ${ay2}`}
                fill="#f97316"
                stroke="none"
              />
            </g>
          );
        })()}
      </svg>

      {/* Overlay is pointer-events:none above; we need a click-blocker behind the card */}
      <div
        style={{
          position: "fixed", inset: 0,
          zIndex: 9991,
          pointerEvents: "auto",
          cursor: "default",
        }}
        onClick={dismiss}
      />

      {/* ── Tour Card ── */}
      <div
        className="animate-in zoom-in-95 fade-in duration-300"
        style={{
          position: "fixed",
          top: Math.max(8, Math.min(cardPos.top, vh - CARD_H - 8)),
          left: Math.max(8, Math.min(cardPos.left, vw - CARD_W - 8)),
          width: CARD_W,
          zIndex: 9999,
          pointerEvents: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-primary px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center justify-center size-10 rounded-xl bg-white/20">
                <Icon className="size-5 text-white" />
              </div>
              <button
                onClick={dismiss}
                className="flex items-center justify-center size-6 rounded-full border-2 border-white/60 text-white hover:bg-white/20 transition-colors shrink-0 mt-0.5"
                aria-label="Skip tour"
              >
                <X className="size-3" />
              </button>
            </div>
            <h2 className="mt-2.5 text-base font-bold text-white leading-snug">{current.title}</h2>
          </div>

          {/* Body */}
          <div className="px-5 pt-3 pb-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{current.body}</p>

            {/* Progress dots */}
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
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
    document.body
  );
}
