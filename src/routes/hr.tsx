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

  // Filter leaves for this teacher
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

  const approvedLeaves  = myLeaves.filter((l) => ["approved","hod_approved"].includes(l.status));
  const pendingLeaves   = myLeaves.filter((l) => ["pending_hod","hod_recommended","pending_principal"].includes(l.status));
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
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Teacher: teacher.full_name, Department: teacher.department_name ?? "—",
      "Monthly Salary": teacher.monthly_salary, "Unpaid Days": totalUnpaid,
      "Deduction (₹)": Math.round(deduction), "Net Payable (₹)": Math.round(net),
    }]), "Salary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(myLeaves.map((l) => ({
      Type: leaveTypeLabel(l.leave_type as LeaveType), From: l.from_date, To: l.to_date,
      Days: l.total_days, Paid: l.paid_days, Unpaid: l.unpaid_days,
      Status: l.status.replace(/_/g, " "),
    }))), "Leaves");
    XLSX.writeFile(wb, `${teacher.full_name.replace(/\s+/g, "_")}_HR.xlsx`);
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
                    {teacher.docs.length > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={zipBusy}
                        onClick={() => downloadAllDocs(teacher, setZipBusy)}>
                        {zipBusy ? <><Loader2 className="size-3 animate-spin" />Zipping…</> : <><Archive className="size-3" />Download All</>}
                      </Button>
                    )}
                  </div>
                  {teacher.docs.length === 0
                    ? <p className="text-sm text-muted-foreground italic">No documents uploaded yet.</p>
                    : <div className="space-y-2">{teacher.docs.map((d) => (
                        <DocRow key={d.id} doc={d} busy={busy}
                          onApprove={() => approveDoc(d.id)}
                          onReject={(n) => rejectDoc(d.id, n)} />
                      ))}</div>
                  }
                  {!hasRequired && <p className="mt-1.5 text-xs text-warning-foreground">Required docs (Degree, Marksheet) not uploaded yet.</p>}
                </div>

                {/* HR decision */}
                {teacher.hr_approved === true ? (
                  <div className="rounded-lg bg-success/10 border border-success/30 px-4 py-3 text-sm text-success flex items-center gap-2">
                    <CheckCircle2 className="size-4 shrink-0" /> Fully onboarded — all features unlocked. Cannot be rejected after approval.
                  </div>
                ) : teacher.hr_approved === false ? (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                    <p className="font-semibold flex items-center gap-2"><XCircle className="size-4 shrink-0" /> Application rejected</p>
                    {teacher.hr_rejection_reason && <p className="mt-1 text-xs">{teacher.hr_rejection_reason}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">Teacher will see the rejection reason and a "Request Again" button.</p>
                  </div>
                ) : (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">HR Decision</p>

                    {/* Required doc checklist */}
                    <div className="rounded-lg bg-muted/40 border border-border px-3 py-2.5 space-y-1.5">
                      {REQUIRED_DOCS.map((type) => {
                        const doc = teacher.docs.find((d) => d.doc_type === type);
                        const label = DOC_LABEL[type];
                        if (!doc) return (
                          <p key={type} className="text-xs flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="size-3 shrink-0" /> {label} — not uploaded
                          </p>
                        );
                        if (doc.status === "approved") return (
                          <p key={type} className="text-xs flex items-center gap-1.5 text-success">
                            <CheckCircle2 className="size-3 shrink-0" /> {label} — approved
                          </p>
                        );
                        if (doc.status === "rejected") return (
                          <p key={type} className="text-xs flex items-center gap-1.5 text-destructive">
                            <XCircle className="size-3 shrink-0" /> {label} — rejected
                          </p>
                        );
                        return (
                          <p key={type} className="text-xs flex items-center gap-1.5 text-warning-foreground">
                            <Clock className="size-3 shrink-0" /> {label} — pending review
                          </p>
                        );
                      })}
                    </div>

                    {!hasRequired && (
                      <p className="text-xs text-warning-foreground">
                        Approve required documents above first — teacher will auto-unlock once all are approved.
                      </p>
                    )}

                    <Textarea rows={2} placeholder="Overall rejection reason (required to reject entire application)…"
                      value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" disabled={busy || !hasRequired} onClick={approveTeacher}>
                        <CheckCircle2 className="size-3.5 mr-1.5" /> Approve & Unlock
                      </Button>
                      <Button size="sm" variant="destructive" className="flex-1" disabled={busy} onClick={rejectTeacher}>
                        <XCircle className="size-3.5 mr-1.5" /> Reject & Reset Docs
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── LEAVES TAB ──────────────────────────────────────────────── */}
            {tab === "leaves" && (
              <>
                <FilterBar />
                <p className="text-xs text-muted-foreground mb-3">
                  Showing only leaves approved by HOD / Principal.
                </p>
                {approvedLeaves.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic text-center py-4">No approved leaves found for this period.</p>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
                    <table className="w-full text-xs min-w-[400px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Type</th>
                          <th className="px-3 py-2 text-left font-semibold">From</th>
                          <th className="px-3 py-2 text-left font-semibold">To</th>
                          <th className="px-3 py-2 text-left font-semibold">Days</th>
                          <th className="px-3 py-2 text-left font-semibold">Unpaid</th>
                          <th className="px-3 py-2 text-left font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {approvedLeaves.map((l) => (
                          <tr key={l.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
                            <td className="px-3 py-2">{fmtDate(l.from_date)}</td>
                            <td className="px-3 py-2">{fmtDate(l.to_date)}</td>
                            <td className="px-3 py-2">{l.total_days}</td>
                            <td className="px-3 py-2 text-destructive font-medium">{Number(l.unpaid_days) > 0 ? l.unpaid_days : "—"}</td>
                            <td className="px-3 py-2"><StatusBadge status={l.status as any} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── SALARY TAB ──────────────────────────────────────────────── */}
            {tab === "salary" && (
              <>
                <FilterBar />
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payroll Summary</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={downloadReport}>
                    <BarChart3 className="size-3.5" /> Download Report
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Monthly Salary",   value: fmtINR(teacher.monthly_salary) },
                    { label: "Unpaid Leave Days", value: `${totalUnpaid} days`, red: totalUnpaid > 0 },
                    { label: "Deduction",         value: fmtINR(deduction), red: deduction > 0 },
                    { label: "Net Payable",       value: fmtINR(net), green: true },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                      <p className={cn("text-sm font-bold mt-0.5", s.red && "text-destructive", s.green && "text-success")}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Based on approved leaves in the selected period. Deduction = salary ÷ 30 × unpaid days.</p>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

function LeaveTable({ rows }: { rows: LeaveRow[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden overflow-x-auto mb-3">
      <table className="w-full text-xs min-w-[400px]">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Type</th>
            <th className="px-3 py-2 text-left font-semibold">From</th>
            <th className="px-3 py-2 text-left font-semibold">To</th>
            <th className="px-3 py-2 text-left font-semibold">Days</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((l) => (
            <tr key={l.id} className="hover:bg-muted/20">
              <td className="px-3 py-2">{leaveTypeLabel(l.leave_type as LeaveType)}</td>
              <td className="px-3 py-2">{fmtDate(l.from_date)}</td>
              <td className="px-3 py-2">{fmtDate(l.to_date)}</td>
              <td className="px-3 py-2">{l.total_days}</td>
              <td className="px-3 py-2"><StatusBadge status={l.status as any} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function HrPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [hrFilter, setHrFilter] = useState<"all"|"pending"|"approved"|"rejected">("pending");
  const [search, setSearch] = useState("");

  // ── Fetch teachers + their docs ───────────────────────────────────────────
  const { data: teachers = [], isLoading: tLoading } = useQuery({
    queryKey: ["hr-teachers"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, user_id, designation, department_id, monthly_salary, approved, hr_approved, hr_rejection_reason, gender, date_of_birth, created_at, departments(name)")
        .eq("approved", true)
        .order("full_name");
      if (error) throw error;

      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const roleMap: Record<string, string> = {};
      for (const r of roles ?? []) roleMap[r.user_id] = r.role;

      const filtered = (profiles ?? []).filter((p) => {
        const r = roleMap[p.id] ?? "teacher";
        return !EXCLUDED_ROLES.includes(r) && p.id !== profile?.id;
      });

      const ids = filtered.map((p) => p.id);
      if (!ids.length) return [];

      const { data: docs } = await supabase
        .from("teacher_documents")
        .select("*")
        .in("teacher_id", ids);

      return filtered.map((p): TeacherProfile => ({
        id: p.id, full_name: p.full_name, user_id: p.user_id,
        designation: p.designation,
        department_name: (p.departments as any)?.name ?? null,
        monthly_salary: Number(p.monthly_salary),
        approved: p.approved,
        hr_approved: (p as any).hr_approved,
        hr_rejection_reason: (p as any).hr_rejection_reason,
        gender: (p as any).gender, date_of_birth: (p as any).date_of_birth,
        created_at: p.created_at,
        docs: (docs ?? []).filter((d) => d.teacher_id === p.id) as TeacherDoc[],
      }));
    },
  });

  // ── Fetch ALL leaves for all teachers in one query (no year filter here — year/month filtering done in card) ──
  const teacherIds = teachers.map((t) => t.id);
  const { data: allLeaves = [], isLoading: lLoading } = useQuery({
    queryKey: ["hr-all-leaves", teacherIds.join(",")],
    enabled: teacherIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, teacher_id, leave_type, from_date, to_date, total_days, paid_days, unpaid_days, status, reason")
        .in("teacher_id", teacherIds)
        .order("from_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["hr-teachers"] });
    qc.invalidateQueries({ queryKey: ["hr-all-leaves"] });
  }

  // Full payroll report — all teachers, current year approved leaves
  function downloadFullReport() {
    const year = String(CURRENT_YEAR);
    const rows = teachers.map((t) => {
      const tLeaves = allLeaves.filter((l) =>
        l.teacher_id === t.id &&
        ["approved","hod_approved"].includes(l.status) &&
        l.from_date.startsWith(year),
      );
      const unpaid    = tLeaves.reduce((s, l) => s + Number(l.unpaid_days), 0);
      const deduction = (t.monthly_salary / 30) * unpaid;
      return {
        Teacher: t.full_name, Department: t.department_name ?? "—",
        Designation: t.designation, Gender: t.gender ?? "—", DOB: t.date_of_birth ?? "—",
        "Monthly Salary": t.monthly_salary,
        "Unpaid Days": unpaid, "Deduction (₹)": Math.round(deduction),
        "Net Payable (₹)": Math.round(t.monthly_salary - deduction),
        "HR Status": t.hr_approved === true ? "Approved" : t.hr_approved === false ? "Rejected" : "Pending",
        "Docs Uploaded": t.docs.length,
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "HR Payroll");
    XLSX.writeFile(wb, `HR_Full_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success("Full report downloaded");
  }

  const filtered = teachers.filter((t) => {
    if (hrFilter === "pending"  && t.hr_approved !== null)  return false;
    if (hrFilter === "approved" && t.hr_approved !== true)  return false;
    if (hrFilter === "rejected" && t.hr_approved !== false) return false;
    if (search && !t.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all:      teachers.length,
    pending:  teachers.filter((t) => t.hr_approved === null).length,
    approved: teachers.filter((t) => t.hr_approved === true).length,
    rejected: teachers.filter((t) => t.hr_approved === false).length,
  };

  const isLoading = tLoading || (teacherIds.length > 0 && lLoading);

  return (
    <Guarded roles={["hr"]}>
      <AppShell title="HR Panel" subtitle="Teacher onboarding, documents, payroll & leave records">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex flex-wrap gap-2">
            {(["all","pending","approved","rejected"] as const).map((f) => (
              <button key={f} onClick={() => setHrFilter(f)}
                className={cn("rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors",
                  hrFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/70")}>
                {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
              </button>
            ))}
          </div>
          <input
            className="h-8 flex-1 min-w-[160px] rounded-lg border border-border bg-muted/30 px-3 text-sm placeholder:text-muted-foreground"
            placeholder="Search teacher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={downloadFullReport} disabled={!teachers.length}>
            <Download className="size-3.5" /> Full Report
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <Empty message={`No ${hrFilter === "all" ? "" : hrFilter} teachers found`} />
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => (
              <TeacherCard key={t.id} teacher={t} leaves={allLeaves} onRefresh={refresh} />
            ))}
          </div>
        )}
      </AppShell>
    </Guarded>
  );
}
