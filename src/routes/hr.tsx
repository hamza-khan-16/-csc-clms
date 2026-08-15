import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Clock, FileText, Eye,
  ChevronDown, ChevronRight, User, Briefcase, Calendar,
  Download, Archive, BarChart3, Wallet, Loader2,
  Users, ClipboardList,
} from "lucide-react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { StatusBadge, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtDate, leaveTypeLabel, LEAVE_TYPES, type LeaveType } from "@/lib/leave";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/hr")({ component: HrPage });

// ── Types ─────────────────────────────────────────────────────────────────────
interface TeacherDoc {
  id: string;
  doc_type: "degree" | "marksheet" | "salary_slip" | "experience_letter";
  file_path: string;
  original_name: string;
  status: "pending" | "approved" | "rejected";
  hr_note: string | null;
}

interface LeaveRow {
  id: string;
  teacher_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  total_days: number;
  paid_days: number;
  unpaid_days: number;
  status: string;
  reason: string | null;
}

interface TeacherProfile {
  id: string;
  full_name: string;
  user_id: string;
  designation: string;
  department_name: string | null;
  monthly_salary: number;
  approved: boolean;
  hr_approved: boolean | null;
  hr_rejection_reason: string | null;
  gender: string | null;
  date_of_birth: string | null;
  created_at: string;
  docs: TeacherDoc[];
}

const DOC_LABEL: Record<string, string> = {
  degree: "Degree Certificate", marksheet: "Marksheet",
  salary_slip: "Salary Slip", experience_letter: "Experience Letter",
};
const REQUIRED_DOCS = ["degree", "marksheet"];
const EXCLUDED_ROLES = ["admin", "principal", "hr"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));
const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));
const isoMonth = (y: number, m: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}`;

// ── Status helpers ────────────────────────────────────────────────────────────
function HrStatusBadge({ v }: { v: boolean | null }) {
  if (v === true)  return <Badge className="bg-success/15 text-success border-success/30 gap-1 text-xs"><CheckCircle2 className="size-3" />Approved</Badge>;
  if (v === false) return <Badge className="bg-destructive/15 text-destructive border-destructive/30 gap-1 text-xs"><XCircle className="size-3" />Rejected</Badge>;
  return <Badge className="bg-warning/15 text-warning-foreground border-warning/30 gap-1 text-xs"><Clock className="size-3" />Pending</Badge>;
}

function DocPill({ s }: { s: "pending"|"approved"|"rejected" }) {
  if (s === "approved") return <span className="text-xs font-semibold text-success flex items-center gap-1"><CheckCircle2 className="size-3" />Approved</span>;
  if (s === "rejected") return <span className="text-xs font-semibold text-destructive flex items-center gap-1"><XCircle className="size-3" />Rejected</span>;
  return <span className="text-xs font-semibold text-warning-foreground flex items-center gap-1"><Clock className="size-3" />Pending</span>;
}

// ── Doc helpers ───────────────────────────────────────────────────────────────
async function signedUrl(path: string) {
  const { data } = await supabase.storage.from("hr-docs").createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}
async function downloadDoc(doc: TeacherDoc) {
  const url = await signedUrl(doc.file_path);
  if (!url) { toast.error("Could not get download link"); return; }
  const a = document.createElement("a");
  a.href = url; a.download = doc.original_name; a.target = "_blank"; a.click();
}
async function downloadAllDocs(teacher: TeacherProfile, setBusy: (v: boolean) => void) {
  if (!teacher.docs.length) { toast.error("No documents"); return; }
  setBusy(true);
  try {
    const zip = new JSZip();
    const folder = zip.folder(teacher.full_name.replace(/\s+/g, "_")) ?? zip;
    await Promise.all(teacher.docs.map(async (doc) => {
      const url = await signedUrl(doc.file_path);
      if (!url) return;
      const blob = await fetch(url).then((r) => r.blob());
      const ext = doc.original_name.split(".").pop() ?? "pdf";
      folder.file(`${DOC_LABEL[doc.doc_type] ?? doc.doc_type}.${ext}`, blob);
    }));
    const content = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = `${teacher.full_name.replace(/\s+/g, "_")}_documents.zip`;
    a.click(); URL.revokeObjectURL(a.href);
    toast.success("All documents downloaded");
  } catch { toast.error("Download failed"); }
  finally { setBusy(false); }
}

// ── Doc review row ────────────────────────────────────────────────────────────
function DocRow({ doc, onApprove, onReject, busy }: {
  doc: TeacherDoc; onApprove: () => void; onReject: (n: string) => void; busy: boolean;
}) {
  const [note, setNote] = useState(doc.hr_note ?? "");
  const [dl, setDl] = useState(false);
  return (
    <div className={cn("rounded-lg border p-3 space-y-2",
      doc.status === "approved" && "border-success/30 bg-success/5",
      doc.status === "rejected" && "border-destructive/30 bg-destructive/5",
      doc.status === "pending"  && "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{DOC_LABEL[doc.doc_type]}</p>
            <p className="text-xs text-muted-foreground truncate">{doc.original_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <DocPill s={doc.status} />
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View"
            onClick={async () => { const u = await signedUrl(doc.file_path); if (u) window.open(u, "_blank"); else toast.error("Could not open"); }}>
            <Eye className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download" disabled={dl}
            onClick={async () => { setDl(true); await downloadDoc(doc); setDl(false); }}>
            {dl ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          </Button>
        </div>
      </div>
      {doc.status !== "approved" && (
        <div className="flex gap-2 items-start">
          <input className="flex-1 text-xs rounded border border-border px-2 py-1.5 bg-background placeholder:text-muted-foreground"
            placeholder="Rejection note (required to reject)…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="outline" className="h-7 shrink-0 text-success border-success/40 hover:bg-success/10" disabled={busy} onClick={onApprove}>
            <CheckCircle2 className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10" disabled={busy} onClick={() => onReject(note)}>
            <XCircle className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Teacher card with tabs ────────────────────────────────────────────────────
type CardTab = "profile" | "leaves" | "salary";

function TeacherCard({ teacher, leaves, onRefresh }: {
  teacher: TeacherProfile; leaves: LeaveRow[]; onRefresh: () => void;
}) {
  const [open,   setOpen]   = useState(false);
  const [tab,    setTab]    = useState<CardTab>("profile");
  const [busy,   setBusy]   = useState(false);
  const [zipBusy,setZipBusy]= useState(false);
  const [note,   setNote]   = useState(teacher.hr_rejection_reason ?? "");

  // Month / year filters (Leaves + Salary tabs)
  const [filterYear,  setFilterYear]  = useState(String(CURRENT_YEAR));
  const [filterMonth, setFilterMonth] = useState<number | "all">("all");
  const [filterType,  setFilterType]  = useState("all");

  // All leaves for this teacher matching year/month/type filters
  const myLeaves = useMemo(() => {
    return leaves
      .filter((l) => l.teacher_id === teacher.id)
      .filter((l) => {
        const ly = l.from_date.slice(0, 4);
        const lm = parseInt(l.from_date.slice(5, 7), 10) - 1; // 0-indexed
        if (ly !== filterYear) return false;
        if (filterMonth !== "all" && lm !== filterMonth) return false;
        if (filterType !== "all" && l.leave_type !== filterType) return false;
        return true;
      });
  }, [leaves, teacher.id, filterYear, filterMonth, filterType]);

  // Only fully approved leaves count for payroll / the Leaves tab
  const approvedLeaves = myLeaves.filter((l) => ["approved", "hod_approved"].includes(l.status));

  // Salary always uses approved leaves only (for deduction calc)
  const totalUnpaid     = approvedLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0);
  const deduction       = (teacher.monthly_salary / 30) * totalUnpaid;
  const net             = teacher.monthly_salary - deduction;

  // Required docs must be APPROVED (not just uploaded) to unlock
  const hasRequired = REQUIRED_DOCS.every((t) =>
    teacher.docs.some((d) => d.doc_type === t && d.status === "approved"),
  );

  async function approveDoc(id: string) {
    setBusy(true);
    const { error } = await supabase
      .from("teacher_documents")
      .update({ status: "approved", hr_note: null })
      .eq("id", id);
    if (error) { toast.error(error.message); setBusy(false); return; }

    // Check if all required docs are now approved after this one
    // Re-fetch docs for this teacher to get fresh state
    const { data: freshDocs } = await supabase
      .from("teacher_documents")
      .select("doc_type, status")
      .eq("teacher_id", teacher.id);

    const allRequiredApproved = REQUIRED_DOCS.every((t) =>
      (freshDocs ?? []).some((d) => d.doc_type === t && d.status === "approved"),
    );

    if (allRequiredApproved) {
      // Auto-unlock teacher when all required docs are approved
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ hr_approved: true, hr_rejection_reason: null })
        .eq("id", teacher.id);
      if (profileErr) toast.error(profileErr.message);
      else toast.success("Document approved — all required docs verified, teacher unlocked!");
    } else {
      toast.success("Document approved");
    }
    onRefresh();
    setBusy(false);
  }

  async function rejectDoc(id: string, n: string) {
    if (!n.trim()) { toast.error("Add a rejection note"); return; }
    setBusy(true);
    const { error } = await supabase
      .from("teacher_documents")
      .update({ status: "rejected", hr_note: n })
      .eq("id", id);
    if (error) { toast.error(error.message); setBusy(false); return; }

    // If hr was previously approved, revoke it since a doc is now rejected
    if (teacher.hr_approved === true) {
      await supabase
        .from("profiles")
        .update({ hr_approved: false, hr_rejection_reason: `Document rejected: ${n}` })
        .eq("id", teacher.id);
      toast.success("Document rejected — teacher access revoked until re-upload");
    } else {
      toast.success("Document rejected");
    }
    onRefresh();
    setBusy(false);
  }
  async function approveTeacher() {
    if (!hasRequired) { toast.error("All required documents must be approved first"); return; }
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ hr_approved: true, hr_rejection_reason: null })
      .eq("id", teacher.id);
    if (error) toast.error(error.message);
    else { toast.success(`${teacher.full_name} approved — all features unlocked`); onRefresh(); }
    setBusy(false);
  }

  async function rejectTeacher() {
    if (!note.trim()) { toast.error("Add a rejection reason for the teacher"); return; }
    setBusy(true);
    // Mark profile as rejected
    const { error } = await supabase
      .from("profiles")
      .update({ hr_approved: false, hr_rejection_reason: note })
      .eq("id", teacher.id);
    if (error) { toast.error(error.message); setBusy(false); return; }
    // Reset ALL docs back to pending so teacher re-uploads everything
    await supabase
      .from("teacher_documents")
      .update({ status: "pending", hr_note: null })
      .eq("teacher_id", teacher.id);
    toast.success("Teacher notified — documents reset to pending for re-upload");
    onRefresh();
    setBusy(false);
  }

  function downloadReport() {
    const wb = XLSX.utils.book_new();
    // Sheet 1: Payroll summary (based on approved leaves — salary-impacting)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Teacher: teacher.full_name, Department: teacher.department_name ?? "—",
      "Filter Period": filterMonth === "all"
        ? filterYear
        : `${MONTHS_SHORT[filterMonth as number]} ${filterYear}`,
      "Monthly Salary": teacher.monthly_salary,
      "Approved Leave Days": approvedLeaves.reduce((s, l) => s + Number(l.total_days), 0),
      "Unpaid Days": totalUnpaid,
      "Deduction (₹)": Math.round(deduction),
      "Net Payable (₹)": Math.round(net),
    }]), "Payroll");
    // Sheet 2: All approved leaves in the filtered period
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      approvedLeaves.length
        ? approvedLeaves.map((l) => ({
            Type: leaveTypeLabel(l.leave_type as LeaveType),
            From: fmtDate(l.from_date), To: fmtDate(l.to_date),
            "Total Days": l.total_days, "Paid Days": l.paid_days,
            "Unpaid Days": l.unpaid_days,
            Status: l.status.replace(/_/g, " "),
          }))
        : [{ Note: "No approved leaves in this period" }]
    ), "Approved Leaves");
    // Sheet 3: Pending / in-progress leaves (for awareness)
    if (pendingLeaves.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        pendingLeaves.map((l) => ({
          Type: leaveTypeLabel(l.leave_type as LeaveType),
          From: fmtDate(l.from_date), To: fmtDate(l.to_date),
          "Total Days": l.total_days,
          Status: l.status.replace(/_/g, " "),
        }))
      ), "Pending Leaves");
    }
    XLSX.writeFile(wb, `${teacher.full_name.replace(/\s+/g, "_")}_HR_${filterYear}.xlsx`);
  }

  const TABS: { id: CardTab; label: string; Icon: any }[] = [
    { id: "profile",  label: "Profile & Docs", Icon: User },
    { id: "leaves",   label: "Approved Leaves", Icon: ClipboardList },
    { id: "salary",   label: "Salary",          Icon: Wallet },
  ];

  // Filter bar — shared between leaves and salary tabs
  const FilterBar = () => (
    <div className="flex flex-wrap gap-2 mb-4">
      <Select value={filterYear} onValueChange={setFilterYear}>
        <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filterMonth === "all" ? "all" : String(filterMonth)} onValueChange={(v) => setFilterMonth(v === "all" ? "all" : Number(v))}>
        <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="All months" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All months</SelectItem>
          {MONTHS_SHORT.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterType} onValueChange={setFilterType}>
        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {LEAVE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((o) => !o)}>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
          {teacher.full_name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight">{teacher.full_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {teacher.designation}{teacher.department_name ? ` · ${teacher.department_name}` : ""} · {fmtINR(teacher.monthly_salary)}/mo
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <HrStatusBadge v={teacher.hr_approved} />
          {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors",
                  tab === id ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30")}>
                <Icon className="size-3.5" />{label}
              </button>
            ))}
          </div>

          <div className="px-4 py-4 space-y-4">

            {/* ── PROFILE TAB ─────────────────────────────────────────────── */}
            {tab === "profile" && (
              <>
                {/* Profile info grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground"><User className="size-3.5" />Gender: <span className="text-foreground font-medium capitalize ml-1">{teacher.gender ?? "—"}</span></div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="size-3.5" />DOB: <span className="text-foreground font-medium ml-1">{teacher.date_of_birth ?? "—"}</span></div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Briefcase className="size-3.5" />College ID: <span className="text-foreground font-medium ml-1 font-mono text-xs">{teacher.user_id}</span></div>
                  <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="size-3.5" />Joined: <span className="text-foreground font-medium ml-1">{fmtDate(teacher.created_at.slice(0, 10))}</span></div>
                </div>

                {/* Documents */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</p>
   
