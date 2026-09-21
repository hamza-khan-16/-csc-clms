import { useState, useEffect } from "react";
import {
  X, ChevronRight, ChevronLeft,
  Sparkles, CalendarPlus, ClipboardList,
  CalendarDays, Repeat, Wallet, PartyPopper,
  CheckCircle2, Users, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TOUR_KEY = "onboarding_tour_done_v1";

interface TourStep {
  title: string;
  body: string;
  Icon: React.ElementType;
}

const TEACHER_STEPS: TourStep[] = [
  {
    Icon: Sparkles,
    title: "Welcome to CSC LMS!",
    body: "This is your Leave Management System. Let's take a quick tour so you know where everything is.",
  },
  {
    Icon: CalendarPlus,
    title: "Apply for Leave",
    body: "Tap 'Apply Leave' in the menu to submit casual, medical, duty, maternity, or bereavement leave. Your HOD reviews it first, then the principal.",
  },
  {
    Icon: ClipboardList,
    title: "Track Your Leaves",
    body: "Go to 'My Leaves' to see all your leave requests, their approval status, and how many days you've used.",
  },
  {
    Icon: CalendarDays,
    title: "Your Schedule",
    body: "'My Schedule' shows your weekly timetable. You'll also see proxy duties assigned to you here.",
  },
  {
    Icon: Repeat,
    title: "Proxy Duties",
    body: "When a colleague is on leave, you may be asked to cover their class. Accept or decline in 'Proxy Duties'. You can also offer compensation.",
  },
  {
    Icon: Wallet,
    title: "Payroll",
    body: "Check your monthly salary slip in 'Payroll'. Any unpaid leave deductions are shown clearly.",
  },
  {
    Icon: PartyPopper,
    title: "You're all set!",
    body: "That's the quick tour. You can always find help by tapping the LeaveBot chat button at the bottom right.",
  },
];

const HOD_STEPS: TourStep[] = [
  {
    Icon: Sparkles,
    title: "Welcome, HOD!",
    body: "As Head of Department, you manage leave approvals and proxy assignments for your department.",
  },
  {
    Icon: CheckCircle2,
    title: "Approve Leaves",
    body: "Go to 'Leave Requests' to review pending leave applications from your department. You can approve or reject with a note.",
  },
  {
    Icon: Users,
    title: "Assign Proxies",
    body: "When approving a leave, assign proxy teachers for each lecture slot. The app shows you who is free and who teaches the same subject.",
  },
  {
    Icon: BarChart3,
    title: "Reports",
    body: "'Reports' gives you a full monthly attendance and leave summary for every teacher in your department. Download as PDF or Excel.",
  },
  {
    Icon: PartyPopper,
    title: "You're ready!",
    body: "Use the LeaveBot at the bottom right any time to ask questions about your team's leaves or schedule.",
  },
];

interface Props {
  role: "teacher" | "hod" | string;
}

export function OnboardingTour({ role }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  const steps = role === "hod" ? HOD_STEPS : TEACHER_STEPS;

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_KEY)) {
        setTimeout(() => setVisible(true), 1200);
      }
    } catch (_) {}
  }, []);

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

  if (!visible) return null;

  const current = steps[step];
  const { Icon } = current;
  const isLast = step === steps.length - 1;

  return (
    <>
      {/* Backdrop — fixed to viewport */}
      <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm" style={{ position: "fixed" }} />

      {/* Card — anchored to viewport bottom, safe-area aware */}
      <div
        className="animate-in slide-in-from-bottom-4 fade-in duration-300"
        style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(calc(100vw - 32px), 400px)",
          zIndex: 301,
        }}
      >
        <div className="rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-primary px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center justify-center size-12 rounded-xl bg-white/20">
                <Icon className="size-6 text-white" />
              </div>
              <button
                onClick={dismiss}
                className="flex items-center justify-center size-7 rounded-full border-2 border-white/60 text-white hover:bg-white/20 transition-colors shrink-0 mt-0.5"
                aria-label="Skip tour"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <h2 className="mt-3 text-lg font-bold text-white leading-snug">{current.title}</h2>
          </div>

          {/* Body */}
          <div className="px-5 pt-4 pb-5 space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>

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
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip tour
              </button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={prev}>
                    <ChevronLeft className="size-3.5" /> Back
                  </Button>
                )}
                <Button size="sm" className="h-8 text-xs gap-1" onClick={next}>
                  {isLast ? "Get started!" : "Next"} {!isLast && <ChevronRight className="size-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
