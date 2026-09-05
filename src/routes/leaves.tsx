import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatCard, StatusBadge, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  fmtDate,
  fmtTime,
  leaveTypeLabel,
  isHodFinalLeave,
  docLabel,
  SESSION_LABEL,
  type LeaveSession,
  type LeaveStatus,
  type LeaveType,
  type DocStatus,
} from "@/lib/leave";
import { AlertTriangle, Calendar, CheckCircle2, List, Paperclip, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MonthCalendar } from "@/components/MonthCalendar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FilterTab = "all" | "pending" | "approved" | "rejected" | "with_docs";

export const Route = createFileRoute("/leaves")({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: (["all","pending","approved","rejected","with_docs"].includes(search.filter as string)
      ? search.filter as FilterTab
      : "all") satisfies FilterTab,
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "My Leaves — CSC Leave Management" },
      {
        name: "description",
        content: "Track your leave history, approval progress, proxy cover and pay-cut days.",
      },
      { property: "og:title", content: "My Leaves — CSC Leave Management" },
      { property: "og:description", content: "Your leave history and approval status." },
    ],
  }),
  component: () => (
    <Guarded roles={["teacher", "hod"]}>
      <MyLeavesPage />
    </Guarded>
  ),
});

const FILTER_OPTIONS: { value: FilterTab; label: string }[] = [
  { value: "all",       label: "All Leaves" },
  { value: "pending",   label: "Pending" },
  { value: "approved",  label: "Approved" },
  { value: "rejected",  label: "Rejected" },
  { value: "with_docs", label: "With Documents" },
];

const PENDING_STATUSES: string[] = ["pending_hod", "hod_recommended", "pending_principal"];

function MyLeavesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { filter } = Route.useSearch();
  const navigate = useNavigate({ from: "/leaves" });

  function setFilter(f: FilterTab) {
    navigate({ search: { filter: f }, replace: true });
  }

  const { data: leaves = [] } = useQuery({
    queryKey: ["my-leaves", profile?.id],
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("teacher_id", profile!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Sort IDs so the key is stable regardless of array reference changes (#3)
  const leaveIdKey = useMemo(() => [...leaves.map((l) => l.id)].sort().join(","), [leaves]);
  const { data: proxies = [] } = useQuery({
    queryKey: ["my-leave-proxies", profile?.id, leaveIdKey],
    enabled: leaves.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_assignments")
        .select("*")
        .in(
          "leave_request_id",
          leaves.map((l) => l.id),
        );
      if (error) throw error;
      return data;
    },
  });

  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // Realtime — only invalidate when status field actually changed
  // Using a ref-based debounce to prevent the refetch from triggering
  // another Supabase write → realtime callback → infinite loop
  const rtDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`leaves-realtime-${profile.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "leave_requests",
        filter: `teacher_id=eq.${profile.id}`,
      }, (payload) => {
        const oldStatus = (payload.old as any)?.status;
        const newStatus = (payload.new as any)?.status;
        // Only act when the status field changed — ignore doc_url, updated_at, etc.
        if (!newStatus || !oldStatus || newStatus === oldStatus) return;
        // Debounce: collapse rapid successive updates into one invalidation
        if (rtDebounce.current) clearTimeout(rtDebounce.current);
        rtDebounce.current = setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["my-leaves", profile.id] });
          toast.info("Your leave status has been updated");
        }, 500);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (rtDebounce.current) clearTimeout(rtDebounce.current);
    };
  }, [profile?.id, qc]);

  const filteredLeaves = useMemo(() => leaves.filter((l) => {
    if (filter === "all") return true;
    if (filter === "pending")  return PENDING_STATUSES.includes(l.status);
    if (filter === "approved") return l.status === "approved" || l.status === "hod_approved";
    if (filter === "rejected") return l.status === "rejected";
    if (filter === "with_docs") return !!l.doc_status;
    return true;
  }), [leaves, filter]);

  // Memoised counts for filter badges — not recalculated per-item in JSX (#15)
  const filterCounts = useMemo(() => ({
    pending:   leaves.filter((l) => PENDING_STATUSES.includes(l.status)).length,
    approved:  leaves.filter((l) => l.status === "approved" || l.status === "hod_approved").length,
    rejected:  leaves.filter((l) => l.status === "rejected").length,
    with_docs: leaves.filter((l) => !!l.doc_status).length,
  }), [leaves]);

  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function cancel(id: string) {
    // Snapshot before delete for audit log
    const { data: req } = await supabase
      .from("leave_requests").select("leave_type, from_date, to_date, status").eq("id", id).single();

    // Insert audit log FIRST while the FK (leave_request_id) still exists in leave_requests.
    // Inserting after delete causes a 409 FK violation even though the column is ON DELETE SET NULL —
    // that clause only applies to existing rows, not new inserts referencing a deleted id.
    if (req) {
      await supabase.from("leave_audit_log").insert({
        leave_request_id: id,
        action: "cancelled",
        actor_id: profile?.id,
        note: `Teacher withdrew ${req.leave_type} leave (${req.from_date} to ${req.to_date}), was: ${req.status}`,
      });
    }

    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);

    setConfirmId(null);
    document.body.style.overflow = "";
    toast.success("Request withdrawn");
    qc.invalidateQueries({ queryKey: ["my-leaves", profile?.id] });
  }

  // Lock body scroll when confirm dialog is open
  useEffect(() => {
    if (confirmId) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [confirmId]);

  // Stats derived from all leaves
  const totalApproved = leaves.filter(l => l.status === "approved" || l.status === "hod_approved").length;
  const totalPending  = leaves.filter(l => PENDING_STATUSES.includes(l.status)).length;
  const totalRejected = leaves.filter(l => l.status === "rejected").length;
  const totalUnpaidDays = leaves
    .filter(l => l.status === "approved" || l.status === "hod_approved")
    .reduce((s, l) => s + Number(l.unpaid_days), 0);

  return (
    <AppShell title="My Leaves" subtitle="All leave requests you have submitted">
      <div className="space-y-4">
        {/* Summary stats strip */}
        {leaves.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total Requests"   value={leaves.length}    />
            <StatCard label="Approved"         value={totalApproved}    tone="success" />
            <StatCard label="Pending Approval" value={totalPending}     tone="warning" />
            <StatCard label="Unpaid Days"      value={totalUnpaidDays}  tone={totalUnpaidDays > 0 ? "destructive" : "success"} hint="salary deduction" />
          </div>
        )}

        {/* Filter + view mode toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Pill tabs — desktop */}
          <div className="hidden sm:flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {FILTER_OPTIONS.map((opt) => {
              const count = opt.value !== "all" ? (filterCounts[opt.value as keyof typeof filterCounts] ?? 0) : null;
              return (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 flex items-center gap-1.5",
                    filter === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                  {count !== null && count > 0 && (
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                      filter === opt.value ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"
                    )}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Select — mobile only */}
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
            <SelectTrigger className="w-44 sm:hidden">
              <SelectValue placeholder="Filter leaves" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                  {opt.value !== "all" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({filterCounts[opt.value as keyof typeof filterCounts] ?? 0})
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-0.5">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="size-3.5" /> List
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${viewMode === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Calendar className="size-3.5" /> Calendar
            </button>
          </div>
        </div>

        {/* Calendar view */}
        {viewMode === "calendar" && (
          <MonthCalendar teacherId={profile?.id} />
        )}

        {/* List view */}
        {viewMode === "list" && (<>

        {leaves.length === 0 && (
          <SectionCard>
            <Empty>You have not applied for any leave yet.</Empty>
          </SectionCard>
        )}
        {leaves.length > 0 && filteredLeaves.length === 0 && (
          <SectionCard>
            <Empty>No leaves match the selected filter.</Empty>
          </SectionCard>
        )}
        {/* 2-column grid for leave cards */}
        <div className="grid gap-3 sm:grid-cols-2">
        {filteredLeaves.map((l) => {
          const cover = proxies.filter((p) => p.leave_request_id === l.id);
          const unpaid = Number(l.unpaid_days);
          const total  = Number(l.total_days);
          const paid   = Number(l.paid_days);
          const hasBigContent = cover.length > 0 || isHodFinalLeave(l.leave_type as LeaveType);
          return (
            <div key={l.id} className={`rounded-xl border border-border bg-card p-4 flex flex-col gap-3 ${hasBigContent ? "sm:col-span-2" : ""}`}>
              {/* Top row — type + status */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm leading-snug">{leaveTypeLabel(l.leave_type as LeaveType)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(l.from_date)}{l.from_date !== l.to_date ? ` – ${fmtDate(l.to_date)}` : ""} · {SESSION_LABEL[l.session as LeaveSession]}
                  </p>
                </div>
                <StatusBadge status={l.status as LeaveStatus} />
              </div>

              {/* Stats row — inline chips */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex flex-col items-center rounded-lg bg-muted px-3 py-1.5 min-w-[52px] text-center">
                  <span className="text-base font-bold leading-none">{total}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Days</span>
                </span>
                <span className="inline-flex flex-col items-center rounded-lg bg-success/10 px-3 py-1.5 min-w-[52px] text-center">
                  <span className="text-base font-bold leading-none text-success">{paid}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Paid</span>
                </span>
                <span className={`inline-flex flex-col items-center rounded-lg px-3 py-1.5 min-w-[52px] text-center ${unpaid > 0 ? "bg-destructive/10" : "bg-muted"}`}>
                  <span className={`text-base font-bold leading-none ${unpaid > 0 ? "text-destructive" : "text-muted-foreground"}`}>{unpaid}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Cut</span>
                </span>
                {l.reason && (
                  <span className="inline-flex flex-col rounded-lg bg-muted px-3 py-1.5 flex-1 min-w-0" title={l.reason}>
                    <span className="text-[10px] text-muted-foreground">Reason</span>
                    <span className="text-xs font-medium truncate">{l.reason}</span>
                  </span>
                )}
              </div>

              {/* Withdraw button — only for pending */}
              {PENDING_STATUSES.includes(l.status) && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setConfirmId(l.id)}>
                  Withdraw request
                </Button>
              )}

              {(l.hod_note || l.principal_note || l.doc_note) && (
                <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
                  {l.hod_note && <p>HOD: {l.hod_note}</p>}
                  {l.principal_note && <p>Principal: {l.principal_note}</p>}
                  {l.doc_note && <p>Document note: {l.doc_note}</p>}
                </div>
              )}

              {/* Document upload — medical / duty leaves after HOD approval */}
              {isHodFinalLeave(l.leave_type as LeaveType) &&
                (l.status === "hod_approved" || l.status === "approved") &&
                l.doc_status !== "verified" && (
                  <DocUploadSection
                    leaveId={l.id}
                    docStatus={(l.doc_status as DocStatus) ?? null}
                    docUrl={l.doc_url ?? null}
                    requiredDoc={docLabel(l.leave_type as LeaveType) ?? "Document"}
                    profileId={profile?.id}
                  />
                )}
              {isHodFinalLeave(l.leave_type as LeaveType) && l.doc_status === "verified" && (
                <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0" /> {docLabel(l.leave_type as LeaveType)} verified by principal.
                </div>
              )}

              {cover.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Proxy cover
                  </p>
                  <ul className="space-y-2 text-sm">
                    {cover.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                      >
                        <span>
                          {fmtDate(p.proxy_date)} · {fmtTime(p.start_time)} – {fmtTime(p.end_time)} ·{" "}
                          {p.subject} ({p.class_name})
                        </span>
                        <span className="text-xs font-semibold capitalize text-muted-foreground">
                          {p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        </div>
        </>)}
      </div>

      {/* Withdraw confirmation dialog */}
      {confirmId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl space-y-4 animate-in fade-in-0 zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5 text-destructive shrink-0"/>
              </div>
              <div>
                <p className="font-semibold text-base">Withdraw request?</p>
                <p className="text-xs text-muted-foreground">This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmId(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={() => cancel(confirmId)}>Yes, withdraw</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </AppShell>
  );
}


function ViewDocButton({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    // doc_url may be a full Supabase public URL from an old upload — extract just the storage path
    const storagePath = path.includes("/object/public/leave-docs/")
      ? path.split("/object/public/leave-docs/")[1]
      : path.includes("/object/sign/leave-docs/")
      ? path.split("/object/sign/leave-docs/")[1]
      : path;

    setLoading(true);
    const { data, error } = await supabase.storage
      .from("leave-docs")
      .createSignedUrl(decodeURIComponent(storagePath), 60);
    setLoading(false);
    if (error || !data?.signedUrl) return toast.error("Could not open document");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Badge
      variant="secondary"
      className="shrink-0 cursor-pointer"
      onClick={open}
    >
      {loading ? "Opening…" : "View"}
    </Badge>
  );
}

function DocUploadSection({
  leaveId,
  docStatus,
  docUrl,
  requiredDoc,
  profileId,
}: {
  leaveId: string;
  docStatus: DocStatus | null;
  docUrl: string | null;
  requiredDoc: string;
  profileId?: string;
}) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) { setSelectedFile(null); return; }

    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`File must be under ${maxMb}MB`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.type)) {
      toast.error("Only PDF, JPG, or PNG files are accepted");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setSelectedFile(file);
  }

  async function handleSubmit() {
    if (!selectedFile) return;

    setUploading(true);
    const path = `${leaveId}/${Date.now()}-${selectedFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("leave-docs")
      .upload(path, selectedFile, { upsert: true });
    if (uploadError) {
      setUploading(false);
      return toast.error(uploadError.message);
    }

    // Bucket is private — store the storage path, not a public URL.
    // Signed URLs are generated on demand when viewing.
    const { error: dbError } = await supabase
      .from("leave_requests")
      .update({ doc_status: "uploaded", doc_url: path })
      .eq("id", leaveId);
    setUploading(false);
    if (dbError) return toast.error(dbError.message);
    setSelectedFile(null);
    if (fileRef.current) fileRef.current.value = "";
    toast.success("Document submitted — awaiting principal verification");
    qc.invalidateQueries({ queryKey: ["my-leaves", profileId] });
  }

  if (docStatus === "verified") return null;

  return (
    <div className="mt-3 rounded-lg border border-info/30 bg-info/8 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            {docStatus === "uploaded"
              ? <><CheckCircle2 className="size-4 text-info shrink-0" /> {requiredDoc} uploaded</>
              : <><Upload className="size-4 shrink-0" /> Upload {requiredDoc}</>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {docStatus === "uploaded"
              ? "Awaiting principal verification. You may re-upload if needed."
              : `Your leave is approved. Please upload your ${requiredDoc} — the principal will verify it for records.`}
          </p>
        </div>
        {docStatus === "uploaded" && docUrl && (
          <ViewDocButton path={docUrl} />
        )}
      </div>

      <div className="mt-3 space-y-2">
        <Input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="text-xs"
          onChange={handleFileChange}
          disabled={uploading}
        />
        {selectedFile && (
          <div className="flex items-center gap-2">
            <span className="truncate text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5"/>{selectedFile.name}</span>
            </span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={uploading}
              className="shrink-0"
            >
              {uploading ? "Uploading…" : "Submit Document"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={() => {
                setSelectedFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Accepted: PDF, JPG, PNG · Max 5 MB</p>
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={tone === "destructive" ? "font-semibold text-destructive" : "font-medium"}>
        {value}
      </p>
    </div>
  );
}
