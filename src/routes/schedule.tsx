import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Gift, LayoutGrid, Printer, Trash2, Upload, X } from "lucide-react";
// jsPDF loaded dynamically inside export functions to keep initial bundle lean.
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent as _TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
const IS_NATIVE_APP = typeof navigator !== "undefined" && /Median|GoNative/i.test(navigator.userAgent);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TooltipContent = (IS_NATIVE_APP ? () => null : _TooltipContent) as typeof _TooltipContent;
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DAYS, fmtDate, fmtTime, todayISO } from "@/lib/leave";
import { cn } from "@/lib/utils";
import { savePDF, saveXLSX } from "../lib/download";

// ── Common subjects list ──────────────────────────────────────────────────────
const COMMON_SUBJECTS = [
  // ── Science & Technology — B.Sc.IT ───────────────────────────────────────
  "Programming in C", "Data Structures", "Database Management Systems",
  "Operating Systems", "Computer Networks", "Web Technologies",
  "Software Engineering", "Object Oriented Programming with Java",
  "Python Programming", "Mobile Application Development",
  "Cloud Computing", "Cyber Security", "Network Security",
  "Linux Administration", "PHP & MySQL", "JavaScript & Frameworks",
  "Computer Organization & Architecture", "Discrete Mathematics",
  "Numerical Methods", "Statistics & Probability",
  "Data Communication", "Internet of Things", "DevOps",

  // ── B.Sc.DS — Data Science ───────────────────────────────────────────────
  "Introduction to Data Science", "Machine Learning", "Deep Learning",
  "Big Data Analytics", "Data Visualization", "Statistical Modeling",
  "R Programming", "Python for Data Science", "Natural Language Processing",
  "Business Intelligence", "Data Warehousing & Mining",
  "Artificial Intelligence", "Neural Networks", "Time Series Analysis",

  // ── B.Sc. AI & ML ────────────────────────────────────────────────────────
  "Foundations of Artificial Intelligence", "Supervised Learning",
  "Unsupervised Learning", "Reinforcement Learning",
  "Computer Vision", "Speech Recognition", "Expert Systems",
  "Knowledge Representation", "Fuzzy Logic", "Genetic Algorithms",
  "Deep Neural Networks", "Transfer Learning", "MLOps",

  // ── B.Sc. CS & DF — Cyber Security & Digital Forensics ──────────────────
  "Ethical Hacking", "Penetration Testing", "Digital Forensics",
  "Cryptography", "Information Security", "Malware Analysis",
  "Incident Response", "Cyber Laws & Ethics", "Steganography",
  "Vulnerability Assessment", "Network Forensics", "Dark Web & Anonymity",

  // ── B.Sc. VFX — Animation & Visual Effects ───────────────────────────────
  "2D Animation", "3D Animation", "Visual Effects",
  "Motion Graphics", "Compositing", "Digital Sculpting",
  "Character Design", "Storyboarding", "Video Editing",
  "Maya & Blender", "Adobe After Effects", "Photoshop & Illustrator",
  "Game Design", "AR / VR Fundamentals",

  // ── BCA — Computer Applications ──────────────────────────────────────────
  "Problem Solving using C", "Object Oriented Programming",
  "Web Designing", "E-Commerce", "Multimedia Applications",
  "Project Management", "Computer Graphics", "Compiler Design",
  "Theory of Computation", "Software Testing",

  // ── Commerce & Arts — B.COM ──────────────────────────────────────────────
  "Financial Accounting", "Cost Accounting", "Management Accounting",
  "Business Law", "Economics", "Business Communication",
  "Taxation (Direct & Indirect)", "Auditing", "Business Mathematics",
  "Commerce", "Entrepreneurship Development",

  // ── BAF — Accounting & Finance ───────────────────────────────────────────
  "Advanced Accounting", "Corporate Finance", "Financial Analysis",
  "Investment Management", "Portfolio Management", "Derivatives & Risk Management",
  "Strategic Financial Management", "International Finance",
  "Mergers & Acquisitions", "Financial Reporting",

  // ── BBI — Banking & Insurance ────────────────────────────────────────────
  "Principles of Banking", "Banking Law & Operations",
  "Insurance Principles & Practice", "Life Insurance", "General Insurance",
  "Central Banking", "Credit Management", "Forex Management",
  "Retail Banking", "Microfinance",

  // ── BFM — Financial Markets ───────────────────────────────────────────────
  "Capital Markets", "Securities Analysis", "Mutual Funds",
  "Commodity Markets", "Technical Analysis", "Fundamental Analysis",
  "Stock Broking", "Wealth Management", "Financial Planning",
  "Regulatory Framework", "Derivatives Trading",

  // ── BAMMC — Multimedia & Mass Communication ───────────────────────────────
  "Journalism", "Advertising & Public Relations",
  "Media Laws & Ethics", "Radio Production", "Television Production",
  "Digital Media & Social Media", "Photography", "Film Studies",
  "Print Media", "Content Writing & Editing", "Event Management",
  "Media Research", "Corporate Communication",

  // ── BMS — Management Studies ─────────────────────────────────────────────
  "Principles of Management", "Human Resource Management",
  "Marketing Management", "Operations Management",
  "Strategic Management", "Organizational Behaviour",
  "Business Research Methods", "Supply Chain Management",
  "Consumer Behaviour", "International Business",
  "Retail Management", "Brand Management",

  // ── Common / Foundation subjects (all courses) ───────────────────────────
  "English Communication", "Environmental Studies",
  "Foundation Course", "Professional Ethics",
  "Applied Mathematics", "Linear Algebra", "Calculus",
];

// ── Subject Combobox ──────────────────────────────────────────────────────────
function SubjectCombobox({
  value,
  onChange,
  existingSubjects,
}: {
  value: string;
  onChange: (v: string) => void;
  existingSubjects: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Merge existing lectures subjects with the common list, deduped
  const allOptions = useMemo(() => {
    const combined = [...new Set([...existingSubjects, ...COMMON_SUBJECTS])];
    return combined.sort((a, b) => a.localeCompare(b));
  }, [existingSubjects]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allOptions;
    const q = query.toLowerCase();
    return allOptions.filter((s) => s.toLowerCase().includes(q));
  }, [allOptions, query]);

  function select(subject: string) {
    onChange(subject);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id="subject"
        placeholder="Search or type a subject…"
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); }}
        autoComplete="off"
        className={value && !open ? "text-foreground font-medium" : ""}
      />
      {/* Current value chip shown when closed */}
      {value && !open && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground truncate max-w-[60%]" />
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {/* "Use typed value" option when query doesn't match any option */}
          {query.trim() && !allOptions.some((s) => s.toLowerCase() === query.toLowerCase()) && (
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted border-b border-border"
              onMouseDown={() => select(query.trim())}
            >
              Use "{query.trim()}"
            </button>
          )}
          {filtered.length === 0 && !query.trim() && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Start typing to search…</p>
          )}
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${s === value ? "bg-primary/10 text-primary font-medium" : ""}`}
              onMouseDown={() => select(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "My Schedule — CSC Leave Management" },
      {
        name: "description",
        content:
          "Fixed weekly timetable plus one-off added lectures, used to assign proxy teachers during leave.",
      },
      { property: "og:title", content: "My Schedule — CSC Leave Management" },
      { property: "og:description", content: "Fixed weekly timetable and dated extra lectures." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <SchedulePage />
    </Guarded>
  ),
});

type Lecture = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject: string;
  class_name: string;
  room: string | null;
  lecture_date: string | null;
  is_proxy?: boolean;
  proxy_status?: string;
  covering_for?: string | null;
};

// Mon=1 … Sat=6, skip Sunday (0)
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

function todayDow() {
  const d = new Date().getDay(); // 0=Sun
  return d === 0 ? 1 : d; // default to Monday if today is Sunday
}

// Subject → colour mapping (cycles through a palette)
const SUBJECT_COLORS = [
  { bg: "bg-blue-600", text: "text-white" },
  { bg: "bg-teal-600", text: "text-white" },
  { bg: "bg-orange-500", text: "text-white" },
  { bg: "bg-purple-600", text: "text-white" },
  { bg: "bg-amber-700", text: "text-white" },
  { bg: "bg-green-600", text: "text-white" },
  { bg: "bg-rose-600", text: "text-white" },
  { bg: "bg-cyan-600", text: "text-white" },
];

function TimetableModal({
  lectures,
  teacherName,
  onClose,
}: {
  lectures: Lecture[];
  teacherName: string;
  onClose: () => void;
}) {
  const fixed = lectures.filter((l) => !l.lecture_date);

  // Collect unique time slots sorted chronologically
  const timeSlots = Array.from(new Set(fixed.map((l) => `${l.start_time}|${l.end_time}`)))
    .sort()
    .map((s) => { const [start, end] = s.split("|"); return { start, end }; });

  // Map subject → colour
  const subjects = Array.from(new Set(fixed.map((l) => l.subject)));
  const subjectColor: Record<string, (typeof SUBJECT_COLORS)[number]> = {};
  subjects.forEach((s, i) => { subjectColor[s] = SUBJECT_COLORS[i % SUBJECT_COLORS.length]; });

  function fmt(t: string) {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  // On mobile we show a day-per-tab view; on md+ we show the full grid
  const DAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES_FULL  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WEEKDAYS_LIST = [1, 2, 3, 4, 5, 6];
  const [mobileDay, setMobileDay] = useState(1);

  async function downloadPDF() {
    const { jsPDF } = await import("jspdf");
    const { autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const PW = doc.internal.pageSize.getWidth();   // 297
    const PH = doc.internal.pageSize.getHeight();  // 210

    // ── Fetch logo and convert to base64 ────────────────────────────────────
    let logoB64: string | null = null;
    try {
      const res = await fetch("/csc-logo.png");
      const blob = await res.blob();
      logoB64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      });
    } catch { /* logo unavailable — skip */ }

    // ── Letterhead ───────────────────────────────────────────────────────────
    const HEADER_H = 36;

    // Light background bar
    doc.setFillColor(248, 248, 248);
    doc.rect(0, 0, PW, HEADER_H, "F");

    // Bottom border line in CSC orange
    doc.setDrawColor(234, 88, 12);   // orange-600
    doc.setLineWidth(0.8);
    doc.line(0, HEADER_H, PW, HEADER_H);

    // Logo — left side
    const LOGO_W = 28;
    const LOGO_H = 16;
    const LOGO_X = 10;
    const LOGO_Y = (HEADER_H - LOGO_H) / 2;
    if (logoB64) {
      doc.addImage(logoB64, "PNG", LOGO_X, LOGO_Y, LOGO_W, LOGO_H);
    }

    // College name block — centred
    const CX = PW / 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    doc.text("Smt. Durgadevi Sharma Charitable Trust's", CX, 7, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text("Chandrabhan Sharma College", CX, 13.5, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    doc.text("Of Arts, Commerce & Science  (AUTONOMOUS)", CX, 18.5, { align: "center" });
    doc.text("(Hindi Linguistic Minority Institution)  ·  (Affiliated to the University of Mumbai)", CX, 22.5, { align: "center" });
    doc.text("NAAC Re-Accredited 'A' Grade (CGPA 3.10)", CX, 26.5, { align: "center" });

    // Teacher name + document label — right aligned
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(20, 20, 20);
    doc.text("Weekly Timetable", PW - 10, 12, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(teacherName, PW - 10, 18, { align: "right" });
    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    doc.setFontSize(6.5);
    doc.text(`Generated: ${today}`, PW - 10, 23, { align: "right" });

    // ── Timetable table ──────────────────────────────────────────────────────
    const DAY_NAMES_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const WEEKDAYS_LIST   = [1, 2, 3, 4, 5, 6];

    function fmt(t: string) {
      const [h, m] = t.split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
    }

    const head = [["Time", ...DAY_NAMES_SHORT]];
    const body = timeSlots.map((slot) => {
      const timeLabel = `${fmt(slot.start)} – ${fmt(slot.end)}`;
      const cells = WEEKDAYS_LIST.map((dow) => {
        const cell = fixed.find(
          (l) => l.day_of_week === dow && l.start_time === slot.start && l.end_time === slot.end
        );
        if (!cell) return "";
        return `${cell.subject}\n${cell.class_name}${cell.room ? ` · ${cell.room}` : ""}`;
      });
      return [timeLabel, ...cells];
    });

    const TABLE_START_Y = HEADER_H + 4;
    const FOOTER_H = 22; // space reserved for signature strip

    if (body.length === 0) {
      doc.setFontSize(11);
      doc.setTextColor(120);
      doc.text("No fixed lectures in timetable.", 14, TABLE_START_Y + 10);
    } else {
      autoTable(doc, {
        head,
        body,
        startY: TABLE_START_Y,
        margin: { bottom: FOOTER_H + 2 },
        styles: { fontSize: 7.5, cellPadding: 2.5, valign: "top", overflow: "linebreak" },
        headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 26 } },
        tableWidth: "auto",
      });
    }

    // ── Signature strip (footer) ─────────────────────────────────────────────
    const FOOTER_Y = PH - FOOTER_H;

    // Thin divider
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(10, FOOTER_Y, PW - 10, FOOTER_Y);

    // Teacher signature block — left
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("Teacher's Signature", 14, FOOTER_Y + 5);
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.4);
    doc.line(14, FOOTER_Y + 13, 75, FOOTER_Y + 13);
    doc.setFontSize(6.5);
    doc.text(teacherName, 14, FOOTER_Y + 17);

    // Principal signature block — right
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("Principal's Signature", PW - 80, FOOTER_Y + 5);
    doc.line(PW - 80, FOOTER_Y + 13, PW - 14, FOOTER_Y + 13);
    doc.setFontSize(6.5);
    doc.text("Principal, Chandrabhan Sharma College", PW - 80, FOOTER_Y + 17);

    // Page number — centre
    doc.setFontSize(6);
    doc.setTextColor(160);
    doc.text(`Page 1`, PW / 2, PH - 4, { align: "center" });

    const safeName = teacherName.split(" ").join("_");
    await savePDF(doc, `Timetable_${safeName}.pdf`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full sm:max-w-5xl rounded-2xl bg-[#111] text-white shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between bg-[#0a0a0a] px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold">Weekly Timetable</h2>
            <p className="text-xs sm:text-sm text-white/50">{teacherName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={downloadPDF} className="rounded-lg p-2 hover:bg-white/10 transition-colors" aria-label="Download timetable as PDF">
                  <Printer className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Download timetable as PDF</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onClose} className="flex items-center justify-center size-8 rounded-full border-2 border-primary text-primary hover:bg-primary hover:text-white transition-colors" aria-label="Close">
                  <X className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Close</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Mobile: day tab strip */}
        <div className="flex gap-1 px-3 pt-3 pb-1 overflow-x-auto lg:hidden shrink-0">
          {WEEKDAYS_LIST.map((dow, i) => (
            <button
              key={dow}
              type="button"
              onClick={() => setMobileDay(dow)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                mobileDay === dow
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white hover:bg-white/10",
              )}
            >
              {DAY_NAMES_SHORT[i]}
            </button>
          ))}
        </div>

        {/* Mobile: stacked card view */}
        <div className="lg:hidden overflow-y-auto p-3 space-y-2 flex-1">
          {timeSlots.length === 0 ? (
            <p className="py-8 text-center text-white/40 text-sm">No fixed lectures yet.</p>
          ) : (
            timeSlots.map((slot) => {
              const cell = fixed.find(
                (l) => l.day_of_week === mobileDay && l.start_time === slot.start && l.end_time === slot.end,
              );
              if (!cell) return null;
              const col = subjectColor[cell.subject];
              return (
                <div key={`${slot.start}-${slot.end}`} className={cn("rounded-xl p-3", col.bg)}>
                  <p className={cn("font-bold text-sm", col.text)}>{cell.subject}</p>
                  <p className={cn("text-xs mt-0.5 opacity-80", col.text)}>
                    {cell.class_name}{cell.room ? ` · ${cell.room}` : ""} · {fmt(slot.start)}–{fmt(slot.end)}
                  </p>
                </div>
              );
            }).filter(Boolean)
          )}
          {timeSlots.length > 0 &&
            !timeSlots.some((slot) =>
              fixed.find((l) => l.day_of_week === mobileDay && l.start_time === slot.start),
            ) && (
              <p className="py-6 text-center text-white/40 text-sm">
                No lectures on {DAY_NAMES_FULL[mobileDay - 1]}.
              </p>
            )}
        </div>

        {/* Desktop: full grid */}
        <div className="hidden lg:block overflow-auto flex-1 p-4">
          <table className="w-full border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="w-28 pb-2 text-left text-xs text-white/40 font-normal" />
                {DAY_NAMES_SHORT.map((d) => (
                  <th key={d} className="pb-2 text-center text-xs font-semibold text-white/70 min-w-[100px]">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-white/40 text-sm">
                    No fixed lectures in your timetable yet.
                  </td>
                </tr>
              ) : (
                timeSlots.map((slot) => (
                  <tr key={`${slot.start}-${slot.end}`}>
                    <td className="pr-3 text-right text-xs text-white/40 font-mono whitespace-nowrap align-middle">
                      {fmt(slot.start)}–{fmt(slot.end)}
                    </td>
                    {WEEKDAYS_LIST.map((dow) => {
                      const cell = fixed.find(
                        (l) => l.day_of_week === dow && l.start_time === slot.start && l.end_time === slot.end,
                      );
                      if (!cell) return <td key={dow} className="rounded-md bg-white/5 min-w-[100px] h-16" />;
                      const col = subjectColor[cell.subject];
                      return (
                        <td key={dow} className={cn("rounded-md px-2 py-1.5 min-w-[100px] h-16 align-top", col.bg)}>
                          <p className={cn("font-bold text-xs leading-tight", col.text)}>{cell.subject}</p>
                          <p className={cn("text-[10px] opacity-80 mt-0.5", col.text)}>
                            {cell.class_name}{cell.room ? ` · ${cell.room}` : ""}
                          </p>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        {subjects.length > 0 && (
          <div className="flex flex-wrap gap-3 px-4 sm:px-6 py-3 border-t border-white/10 shrink-0">
            {subjects.map((s) => {
              const col = subjectColor[s];
              return (
                <span key={s} className="flex items-center gap-1.5 text-xs text-white/60">
                  <span className={cn("inline-block size-3 rounded-sm", col.bg)} />
                  {s}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SchedulePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();
  const [showTimetable, setShowTimetable] = useState(false);

  // Selected weekday tab (1=Mon … 6=Sat)
  const [selectedDay, setSelectedDay] = useState<number>(todayDow());

  // Week offset: 0 = current week, -1 = last week, +1 = next week, etc.
  const [weekOffset, setWeekOffset] = useState(0);

  // Derive the Mon–Sat ISO date range for the currently viewed week
  const { weekStart, weekEnd, weekDates } = useMemo(() => {
    const now = new Date(today + "T00:00:00");
    const dow = now.getDay() === 0 ? 7 : now.getDay(); // Mon=1…Sun=7
    const mon = new Date(now);
    mon.setDate(now.getDate() - dow + 1 + weekOffset * 7);
    const sat = new Date(mon);
    sat.setDate(mon.getDate() + 5);
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    // Map dow (1=Mon…6=Sat) → the ISO date of that day this week
    const dates: Record<number, string> = {};
    for (let i = 1; i <= 6; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + (i - 1));
      dates[i] = iso(d);
    }
    return { weekStart: iso(mon), weekEnd: iso(sat), weekDates: dates };
  }, [today, weekOffset]);

  const [mode, setMode] = useState<"fixed" | "added">("fixed");
  const [form, setForm] = useState({
    day: String(todayDow()),
    date: today,
    start: "09:00",
    end: "10:00",
    subject: "",
    className: "",
    room: "",
  });

  // ── Fetch own lectures ──────────────────────────────────────────────────────
  const { data: lectures = [] } = useQuery({
    queryKey: ["my-lectures", profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lectures")
        .select("id, day_of_week, start_time, end_time, subject, class_name, room, lecture_date")
        .eq("teacher_id", profile!.id)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as Lecture[];
    },
  });

  // ── Fetch accepted proxy duties ─────────────────────────────────────────────
  const { data: proxies = [] } = useQuery({
    queryKey: ["my-accepted-proxies", profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("id, proxy_date, start_time, end_time, subject, class_name, leave_request_id, status")
        .eq("proxy_teacher_id", profile!.id)
        .in("status", ["pending", "accepted"])
        .gte("proxy_date", today)
        .order("proxy_date")
        .order("start_time");
      if (error) throw error;

      // Fetch absentee names
      const reqIds = (data ?? []).map((p) => p.leave_request_id).filter((id): id is string => id !== null);
      let nameMap: Record<string, string> = {};
      if (reqIds.length) {
        const { data: reqs } = await supabase
          .from("leave_requests")
          .select("id, teacher_id")
          .in("id", reqIds);
        const teacherIds = [...new Set((reqs ?? []).map((r) => r.teacher_id))];
        if (teacherIds.length) {
          const { data: people } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", teacherIds);
          const personMap = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
          nameMap = Object.fromEntries(
            (reqs ?? []).map((r) => [r.id, personMap[r.teacher_id] ?? "a colleague"]),
          );
        }
      }

      return (data ?? []).map((p) => ({
        id: p.id,
        day_of_week: new Date(p.proxy_date + "T00:00:00").getDay(),
        start_time: p.start_time,
        end_time: p.end_time,
        subject: p.subject,
        class_name: p.class_name,
        room: null as string | null,
        lecture_date: p.proxy_date,
        is_proxy: true,
        proxy_status: p.status as string,
        covering_for: p.leave_request_id ? (nameMap[p.leave_request_id] ?? null) : null,
      })) as Lecture[];
    },
  });

  // ── Fetch pending compensation offers (so absent teacher sees notification) ──
  const { data: pendingCompOffers = [] } = useQuery({
    queryKey: ["pending-comp-offers", profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compensation_assignments")
        .select("id, from_teacher_id, compensation_date, lecture_id, note, status")
        .eq("to_teacher_id", profile!.id)
        .eq("status", "pending")
        .order("compensation_date");
      if (error) throw error;
      const rows = data ?? [];
      const fromIds = [...new Set(rows.map((r) => r.from_teacher_id))];
      const { data: people } = fromIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", fromIds)
        : { data: [] };
      const personMap = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
      // Fetch lecture details for each offer
      const lecIds = [...new Set(rows.map((r) => r.lecture_id))];
      const { data: lectures } = lecIds.length
        ? await supabase.from("lectures").select("id, subject, class_name, start_time, end_time").in("id", lecIds)
        : { data: [] };
      const lecMap = Object.fromEntries((lectures ?? []).map((l) => [l.id, l]));
      return rows.map((r) => ({
        ...r,
        from_name: personMap[r.from_teacher_id] ?? "A colleague",
        lecture: lecMap[r.lecture_id] ?? null,
      }));
    },
  });

  // ── Cleanup stale dated lectures (past dates) ───────────────────────────────
  // Calls the server-side function which cleans up ALL expired dated rows:
  // - Compensation lectures added to the leave-taker's schedule
  // - __COMP_GIVEN__ tombstone rows that suppressed the proxy teacher's slot
  // Both categories are temporary and must vanish once their date has passed.
  useEffect(() => {
    if (!profile) return;
    supabase.rpc("cleanup_expired_dated_lectures").then(({ error }) => {
      if (!error) qc.invalidateQueries({ queryKey: ["my-lectures"] });
    });
  }, [profile, qc]);

  // ── Derive what to show for selectedDay in the viewed week ─────────────────
  // Tombstones scoped to the viewed week's date for selectedDay.
  // A __COMP_GIVEN__ row means the teacher gave away that fixed slot on that
  // specific date — suppress the recurring lecture only for that date.
  const tombstonedOnViewedDate = useMemo(() => {
    const viewedDate = weekDates[selectedDay];
    return new Set(
      lectures
        .filter((l) => l.lecture_date === viewedDate && l.subject.startsWith("__COMP_GIVEN__"))
        .map((l) => `${l.start_time}|${l.end_time}`)
    );
  }, [lectures, weekDates, selectedDay]);

  const fixedForDay = useMemo(
    () => lectures.filter((l) => {
      if (l.lecture_date || l.day_of_week !== selectedDay) return false;
      // Suppress if this slot was given away via compensation on the viewed date
      if (tombstonedOnViewedDate.has(`${l.start_time}|${l.end_time}`)) return false;
      return true;
    }),
    [lectures, selectedDay, tombstonedOnViewedDate],
  );

  // Dated lectures for the selected weekday — only the one that falls on this
  // week's date for that day, not any future/past week's entry.
  const datedForDay = useMemo(
    () =>
      lectures.filter(
        (l) =>
          l.lecture_date &&
          l.lecture_date === weekDates[selectedDay] &&
          l.day_of_week === selectedDay &&
          !l.subject.startsWith("__COMP_GIVEN__"),
      ),
    [lectures, selectedDay, weekDates],
  );

  // Accepted proxies for the selected weekday
  // Proxies scoped to this week only — a proxy on Wed 13 Aug only shows on
  // the Wednesday tab when you're viewing the week of 11–16 Aug.
  const proxiesForDay = useMemo(
    () => proxies.filter((p) => p.day_of_week === selectedDay && p.lecture_date === weekDates[selectedDay]),
    [proxies, selectedDay, weekDates],
  );

  const allForDay = useMemo(
    () =>
      [...fixedForDay, ...datedForDay, ...proxiesForDay].sort((a, b) =>
        a.start_time.localeCompare(b.start_time),
      ),
    [fixedForDay, datedForDay, proxiesForDay],
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  async function addLecture(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim() || !form.className.trim())
      return toast.error("Subject and class are required");
    if (form.end <= form.start) return toast.error("End time must be after start time");
    if (mode === "added" && form.date < today)
      return toast.error("Pick today or a future date");

    const dow =
      mode === "added" ? new Date(form.date + "T00:00:00").getDay() : Number(form.day);

    const { error } = await supabase.from("lectures").insert({
      teacher_id: profile!.id,
      department_id: profile!.department_id,
      day_of_week: dow,
      lecture_date: mode === "added" ? form.date : null,
      start_time: form.start,
      end_time: form.end,
      subject: form.subject.trim(),
      class_name: form.className.trim(),
      room: form.room.trim(),
    });
    if (error) return toast.error(error.message);
    setForm({ ...form, subject: "", className: "", room: "" });
    // After adding, jump to the selected day so user sees their new entry
    if (mode === "added") {
      setSelectedDay(dow === 0 ? 1 : dow);
    } else {
      setSelectedDay(Number(form.day));
    }
    toast.success(mode === "added" ? "Added schedule created" : "Lecture added to fixed timetable");
    qc.invalidateQueries({ queryKey: ["my-lectures"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("lectures").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["my-lectures"] });
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const todayDowValue = new Date().getDay();
  const totalLectures = lectures.filter(l => !l.lecture_date).length;
  const todayCount = lectures.filter(l => !l.lecture_date && l.day_of_week === todayDowValue).length;
  const proxiesThisYear = proxies.filter((p: any) => p.status === "accepted").length;

  return (
    <AppShell title="My Schedule" subtitle="Fixed timetable, added lectures and accepted proxy duties">
      {showTimetable && createPortal(
        <TimetableModal
          lectures={lectures}
          teacherName={profile?.full_name ?? ""}
          onClose={() => setShowTimetable(false)}
        />,
        document.body
      )}

      {/* Quick stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="surface p-4">
          <p className="text-xs text-muted-foreground font-medium">Weekly Lectures</p>
          <p className="text-2xl font-extrabold mt-1">{totalLectures}</p>
          <p className="text-xs text-muted-foreground mt-0.5">recurring per week</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-muted-foreground font-medium">Today's Lectures</p>
          <p className="text-2xl font-extrabold mt-1 text-primary">{todayCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{new Date().toLocaleDateString("en-GB",{weekday:"long"})}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-muted-foreground font-medium">Proxy Accepted</p>
          <p className="text-2xl font-extrabold mt-1 text-success">{proxiesThisYear}</p>
          <p className="text-xs text-muted-foreground mt-0.5">this year</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Pending compensation offers banner */}
          {pendingCompOffers.length > 0 && (
            <div className="rounded-lg border border-success/40 bg-success/8 p-4 space-y-2">
              <p className="text-sm font-semibold text-success-foreground flex items-center gap-1"><Gift className="size-4"/>Compensation lecture offers pending your response</p>
              <p className="text-xs text-muted-foreground">Go to <strong>Proxy Duties</strong> to accept or decline. Accepted lectures will appear in your schedule automatically.</p>
              <ul className="mt-2 space-y-1">
                {pendingCompOffers.map((o) => (
                  <li key={o.id} className="text-xs text-muted-foreground">
                    · {o.from_name} is offering you a {o.lecture?.subject ?? "lecture"} ({o.lecture?.class_name}) on {fmtDate(o.compensation_date)}
                    {o.note ? ` — "${o.note}"` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Week navigator */}
          {(() => {
            const pad = (n: number) => String(n).padStart(2, "0");
            const fmt = (iso: string) => {
              const [, m, d] = iso.split("-");
              return `${Number(d)} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m)-1]}`;
            };
            const isCurrentWeek = weekOffset === 0;
            return (
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-3 py-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setWeekOffset((w) => w - 1)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label="Previous week"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Previous week</TooltipContent>
                </Tooltip>
                <div className="text-center">
                  <p className="text-sm font-semibold">
                    {isCurrentWeek ? "This week" : weekOffset === 1 ? "Next week" : weekOffset === -1 ? "Last week" : `Week of ${fmt(weekStart)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmt(weekStart)} – {fmt(weekEnd)}</p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setWeekOffset((w) => w + 1)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label="Next week"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Next week</TooltipContent>
                </Tooltip>
              </div>
            );
          })()}

          {/* Day-of-week tab strip */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((dow) => {
              const isToday = weekDates[dow] === today;
              const isSelected = dow === selectedDay;
              // Dot indicators for this week's date on this day
              const dateForDow = weekDates[dow];
              const hasProxy = proxies.some((p) => p.lecture_date === dateForDow);
              const hasComp  = lectures.some((l) => l.lecture_date === dateForDow && !l.subject.startsWith("__COMP_GIVEN__"));
              return (
                <button
                  key={dow}
                  type="button"
                  onClick={() => setSelectedDay(dow)}
                  className={cn(
                    "relative rounded-xl px-4 py-2 text-sm font-semibold transition-all",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {DAYS[dow].slice(0, 3)}
                  {isToday && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-success" />
                  )}
                  {!isToday && hasProxy && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
                  )}
                  {!isToday && !hasProxy && hasComp && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-blue-400" />
                  )}
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => setShowTimetable(true)}
          >
            <LayoutGrid className="size-4" />
            View Timetable
          </Button>
          </div>

          {/* Day schedule card */}
          {(() => {
            const viewedDate = weekDates[selectedDay];
            const isToday = viewedDate === today;
            const [, m, d] = viewedDate.split("-");
            const dateLabel = `${Number(d)} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m)-1]}`;
            return (
              <SectionCard
                title={DAYS[selectedDay]}
                subtitle={isToday ? `Today · ${dateLabel}` : dateLabel}
              >
            {allForDay.length === 0 ? (
              <Empty>No lectures scheduled for {DAYS[selectedDay]}.</Empty>
            ) : (
              <ul className="space-y-2">
                {allForDay.map((l) => (
                  <LectureRow key={l.id} lecture={l} onRemove={l.is_proxy ? undefined : remove} />
                ))}
              </ul>
            )}
              </SectionCard>
            );
          })()}

          {/* Upcoming dated lectures summary (all days) */}
          {(() => {
            const upcoming = lectures
              .filter((l) => l.lecture_date && l.lecture_date >= today && !l.subject.startsWith("__COMP_GIVEN__"))
              .sort((a, b) =>
                (a.lecture_date! + a.start_time).localeCompare(b.lecture_date! + b.start_time),
              );
            const upcomingProxies = proxies
              .slice()
              .sort((a, b) =>
                (a.lecture_date! + a.start_time).localeCompare(b.lecture_date! + b.start_time),
              );
            const all = [...upcoming, ...upcomingProxies].sort((a, b) =>
              (a.lecture_date! + a.start_time).localeCompare(b.lecture_date! + b.start_time),
            );
            if (all.length === 0) return null;
            return (
              <SectionCard
                title="Upcoming one-off lectures"
                subtitle="Added lectures and proxy duties — removed automatically once the date passes"
              >
                <ul className="space-y-2">
                  {all.map((l) => (
                    <LectureRow key={l.id} lecture={l} onRemove={l.is_proxy ? undefined : remove} showDate />
                  ))}
                </ul>
              </SectionCard>
            );
          })()}
        </div>

        {/* Add lecture sidebar */}
        <SectionCard title="Add Lecture">
          <form onSubmit={addLecture} className="space-y-3">
            <div className="space-y-2">
              <Label>Schedule type</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "fixed" | "added")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed — every week</SelectItem>
                  <SelectItem value="added">Added — a single date</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "fixed" ? (
              <div className="space-y-2">
                <Label>Day</Label>
                <Select value={form.day} onValueChange={(v) => setForm({ ...form, day: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {DAYS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="ldate">Date</Label>
                <Input
                  id="ldate"
                  type="date"
                  min={today}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start">Start</Label>
                <Input
                  id="start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">End</Label>
                <Input
                  id="end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              {/* Combobox: choose from existing subjects or type a new one */}
              <SubjectCombobox
                value={form.subject}
                onChange={(v) => setForm({ ...form, subject: v })}
                existingSubjects={Array.from(new Set(lectures.map((l) => l.subject).filter(Boolean)))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="class">Class</Label>
              <Select
                value={form.className}
                onValueChange={(v) => setForm({ ...form, className: v })}
              >
                <SelectTrigger id="class">
                  <SelectValue placeholder="Select class…" />
                </SelectTrigger>
                <SelectContent>
                  {/* Science & Technology */}
                  {[
                    "B.Sc.IT","B.Sc.DS","B.Sc.(AI & ML)","B.Sc.(CS & DF)","B.Sc.(VFX)","BCA",
                    "B.COM","BAF","BBI","BFM","BAMMC","BMS",
                  ].flatMap((course) =>
                    ["FY","SY","TY"].map((yr) => (
                      <SelectItem key={`${course}-${yr}`} value={`${yr} ${course}`}>
                        {yr} {course}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="room">Room</Label>
              <Input
                id="room"
                placeholder="301"
                value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full">
              {mode === "added" ? "Add to schedule" : "Add to fixed timetable"}
            </Button>
          </form>
        </SectionCard>

        {/* ── Excel bulk upload ─────────────────────────────────────────── */}
        <ExcelUploadCard teacherId={profile!.id} departmentId={profile?.department_id ?? null} onDone={() => qc.invalidateQueries({ queryKey: ["my-lectures"] })} />
      </div>
    </AppShell>
  );
}

// ── Excel Upload Card ─────────────────────────────────────────────────────────
// Expected Excel format (any sheet name):
//   Col A: Day       — Mon / Monday / 1-7 / Sun=0
//   Col B: Start     — HH:MM  e.g. 09:00
//   Col C: End       — HH:MM  e.g. 10:00
//   Col D: Subject   — free text
//   Col E: Class     — e.g. FYBSc IT
//   Col F: Room      — optional, e.g. 301
//
// A template can be downloaded from the card.
const DAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function parseTime(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already HH:MM
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    if (h >= 0 && h < 24 && m >= 0 && m < 60)
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  // Excel serial time (fraction of a day)
  const n = parseFloat(s);
  if (!isNaN(n) && n > 0 && n < 1) {
    const totalMin = Math.round(n * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

function parseDay(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (DAY_MAP[s] !== undefined) return DAY_MAP[s];
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0 && n <= 6) return n;
  return null;
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const rows = [
    ["Day", "Start", "End", "Subject", "Class", "Room"],
    ["Monday", "09:00", "10:00", "Mathematics", "FYBSc IT", "301"],
    ["Monday", "10:00", "11:00", "Physics", "SYBSc IT", "302"],
    ["Tuesday", "11:00", "12:00", "Chemistry", "TYBSc IT", "Lab 1"],
    ["Wednesday", "08:00", "09:00", "English", "FYBCom", "201"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [14, 10, 10, 30, 18, 10].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  XLSX.writeFile(wb, "fixed_schedule_template.xlsx");
}

function ExcelUploadCard({
  teacherId,
  departmentId,
  onDone,
}: {
  teacherId: string;
  departmentId: string | null;
  onDone: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Array<{
    day: number; start: string; end: string; subject: string; className: string; room: string;
  }> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useState<HTMLInputElement | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

      const errs: string[] = [];
      const parsed: typeof preview = [];

      // Skip header row (row 0) if it looks like a header
      const startRow = String(rows[0]?.[0] ?? "").toLowerCase().includes("day") ? 1 : 0;

      rows.slice(startRow).forEach((row, i) => {
        const rowNum = startRow + i + 1;
        const [rawDay, rawStart, rawEnd, rawSubject, rawClass, rawRoom] = row as unknown[];
        if (!rawDay && !rawSubject) return; // blank row

        const day = parseDay(rawDay);
        const start = parseTime(rawStart);
        const end = parseTime(rawEnd);
        const subject = String(rawSubject ?? "").trim();
        const className = String(rawClass ?? "").trim();
        const room = String(rawRoom ?? "").trim();

        if (day === null) { errs.push(`Row ${rowNum}: invalid day "${rawDay}"`); return; }
        if (!start) { errs.push(`Row ${rowNum}: invalid start time "${rawStart}"`); return; }
        if (!end) { errs.push(`Row ${rowNum}: invalid end time "${rawEnd}"`); return; }
        if (start >= end) { errs.push(`Row ${rowNum}: start must be before end`); return; }
        if (!subject) { errs.push(`Row ${rowNum}: subject is required`); return; }
        if (!className) { errs.push(`Row ${rowNum}: class name is required`); return; }

        parsed.push({ day, start, end, subject, className, room });
      });

      setErrors(errs);
      setPreview(parsed.length > 0 ? parsed : null);
    };
    reader.readAsArrayBuffer(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  async function confirmUpload() {
    if (!preview?.length) return;
    setUploading(true);
    try {
      // Delete all existing fixed lectures for this teacher first
      await supabase
        .from("lectures")
        .delete()
        .eq("teacher_id", teacherId)
        .is("lecture_date", null);

      // Insert the new ones
      const inserts = preview.map((r) => ({
        teacher_id: teacherId,
        department_id: departmentId,
        day_of_week: r.day,
        lecture_date: null,
        start_time: r.start + ":00",
        end_time: r.end + ":00",
        subject: r.subject,
        class_name: r.className,
        room: r.room,
      }));

      const { error } = await supabase.from("lectures").insert(inserts);
      if (error) { toast.error(error.message); return; }

      toast.success(`Fixed schedule uploaded — ${inserts.length} lecture${inserts.length !== 1 ? "s" : ""} set`);
      setPreview(null);
      setErrors([]);
      onDone();
    } finally {
      setUploading(false);
    }
  }

  const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <SectionCard
      title="Upload Fixed Schedule"
      subtitle="Import your full weekly timetable from an Excel file"
    >
      <div className="space-y-4">
        {/* Info + template download */}
        <div className="rounded-lg bg-info/10 border border-info/20 p-3 text-xs text-info-foreground space-y-1">
          <p className="font-semibold">Excel format (columns in order):</p>
          <p>A: Day &nbsp;·&nbsp; B: Start (HH:MM) &nbsp;·&nbsp; C: End (HH:MM) &nbsp;·&nbsp; D: Subject &nbsp;·&nbsp; E: Class &nbsp;·&nbsp; F: Room (optional)</p>
          <p className="text-muted-foreground">Uploading will <strong>replace</strong> your entire fixed timetable. Added and proxy lectures are not affected.</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
            <Upload className="size-4 rotate-180" />
            Download template
          </Button>
          <label className="flex-1">
            <Button variant="default" size="sm" className="w-full gap-1.5 cursor-pointer" asChild>
              <span>
                <Upload className="size-4" />
                {preview ? "Choose different file" : "Choose Excel file"}
              </span>
            </Button>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={handleFile}
            />
          </label>
        </div>

        {/* Parse errors */}
        {errors.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-1">
            <p className="text-xs font-semibold text-destructive">
              {errors.length} row{errors.length !== 1 ? "s" : ""} could not be parsed:
            </p>
            <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {/* Preview table */}
        {preview && preview.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Preview — {preview.length} lecture{preview.length !== 1 ? "s" : ""} found
            </p>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {["Day", "Time", "Subject", "Class", "Room"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-medium">{DAYS_SHORT[r.day]}</td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{r.start}–{r.end}</td>
                      <td className="px-2 py-1.5 max-w-[120px] truncate">{r.subject}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.className}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.room || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => { setPreview(null); setErrors([]); }}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1" onClick={confirmUpload} disabled={uploading}>
                {uploading ? "Uploading…" : `Confirm & replace timetable`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function LectureRow({
  lecture: l,
  onRemove,
  showDate = false,
}: {
  lecture: Lecture;
  onRemove?: (id: string) => void;
  showDate?: boolean;
}) {
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold truncate">{l.subject}</span>
            <span className="text-muted-foreground text-xs">{l.class_name}</span>
            {l.room && <span className="text-muted-foreground text-xs">· {l.room}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtTime(l.start_time)} – {fmtTime(l.end_time)}
            {showDate && l.lecture_date ? ` · ${fmtDate(l.lecture_date)}` : ""}
          </p>
          <div className="mt-1.5">
            {l.is_proxy ? (
              <Badge
                variant="secondary"
                className={
                  l.proxy_status === "accepted"
                    ? "border border-warning/30 bg-warning/12 text-warning-foreground text-[10px]"
                    : "border border-muted-foreground/30 bg-muted text-muted-foreground text-[10px]"
                }
              >
                {l.proxy_status === "accepted" ? "Proxy" : "Proxy (pending)"} · covering {l.covering_for ?? "colleague"}
              </Badge>
            ) : l.lecture_date ? (
              <Badge variant="outline" className="border-info/30 bg-info/12 text-info text-[10px]">
                Added lecture
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">
                Every week
              </Badge>
            )}
          </div>
        </div>
        {onRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 -mt-1" onClick={() => onRemove(l.id)}>
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Remove lecture</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}
