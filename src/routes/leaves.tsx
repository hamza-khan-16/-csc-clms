import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, StatusBadge, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  emergencyMsRemaining,
  fmtDate,
  fmtMs,
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
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/leaves")({
  head: () => ({
    meta: [
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

type FilterTab = "all" | "pending" | "approved" | "rejected" | "with_docs";

const FILTER_OPTIONS: { value: FilterTab; label: string }[] = [
  { value: "all",       label: "All Leaves" },
  { value: "pending",   label: "Pending" },
  { value: "approved",  label: "Approved" },
  { value: "rejected",  label: "Rejected" },
  { value: "with_docs", label: "With Documents" },
];

function MyLeavesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("all");

  const { data: leaves = [] } = useQuery({
    queryKey: ["my-leaves", profile?.id],
    enabled: !!profile,
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

  const { data: proxies = [] } = useQuery({
    queryKey: ["my-leave-proxies", profile?.id, leaves.map((l) => l.id).join(",")],
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

  const filteredLeaves = leaves.filter((l) => {
    if (filter === "all") return true;
    if (filter === "pending") return l.status === "pending_hod" || l.status === "pending_principal";
    if (filter === "approved") return l.status === "approved" || l.status === "hod_approved";
    if (filter === "rejected") return l.status === "rejected";
    if (filter === "with_docs") return !!l.doc_status;
    return true;
  });

  async function cancel(id: string) {
    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Request withdrawn");
    qc.invalidateQueries();
  }

  return (
    <AppShell title="My Leaves" subtitle="All leave requests you have submitted">
      <div className="space-y-4">
        {/* Filter dropdown */}
        <div className="flex items-center gap-3">
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter leaves" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                  {opt.value !== "all" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({leaves.filter((l) => {
                        if (opt.value === "pending")   return l.status === "pending_hod" || l.status === "pending_principal";
                        if (opt.value === "approved")  return l.status === "approved" || l.status === "hod_approved";
                        if (opt.value === "rejected")  return l.status === "rejected";
                        if (opt.value === "with_docs") return !!l.doc_status;
                        return false;
                      }).length})
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filter !== "all" && (
            <button
              className="text-xs text-muted-foreground underline"
              onClick={() => setFilter("all")}
            >
              Clear filter
            </button>
          )}
        </div>

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
        {filteredLeaves.map((l) => {
          const cover = proxies.filter((p) => p.leave_request_id === l.id);
          return (
            <SectionCard key={l.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold">{leaveTypeLabel(l.leave_type as LeaveType)}</p>
                  <p className="text-sm text-muted-foreground">
                    {fmtDate(l.from_date)} – {fmtDate(l.to_date)} ·{" "}
                    {SESSION_LABEL[l.session as LeaveSession]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={l.status as LeaveStatus} />
                  {(l.status === "pending_hod" || l.status === "pending_principal") && (
                    <Button variant="ghost" size="sm" onClick={() => cancel(l.id)}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>

              {l.leave_type === "emergency" && l.status === "pending_principal" && (
                <EmergencyCountdown createdAt={l.created_at} />
              )}

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <Field label="Reason" value={l.reason} />
                <Field label="Days counted" value={`${Number(l.total_days)}`} />
                <Field label="Paid days" value={`${Number(l.paid_days)}`} />
                <Field
                  label="Pay cut days"
                  value={`${Number(l.unpaid_days)}`}
                  tone={Number(l.unpaid_days) > 0 ? "destructive" : undefined}
                />
              </div>

              {(l.hod_note || l.principal_note || l.doc_note) && (
                <div className="mt-3 space-y-1 rounded-lg bg-muted p-3 text-xs">
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
                  />
                )}
              {isHodFinalLeave(l.leave_type as LeaveType) && l.doc_status === "verified" && (
                <div className="mt-3 rounded-lg border border-success/30 bg-success/8 p-3 text-sm text-success">
                  ✅ {docLabel(l.leave_type as LeaveType)} verified by principal.
                </div>
              )}

              {cover.length > 0 && (
                <div className="mt-4">
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
            </SectionCard>
          );
        })}
      </div>
    </AppShell>
  );
}

function EmergencyCountdown({ createdAt }: { createdAt: string }) {
  const [msLeft, setMsLeft] = useState(() => emergencyMsRemaining(createdAt));
  useEffect(() => {
    const id = setInterval(() => setMsLeft(emergencyMsRemaining(createdAt)), 1000);
    return () => clearInterval(id);
  }, [createdAt]);
  if (msLeft === 0) {
    return (
      <div className="mt-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-xs font-semibold text-success">
        ✓ Auto-approved — awaiting system update
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
      <span>⚡ Emergency leave — auto-approves (unpaid) in</span>
      <span className="font-mono font-bold">{fmtMs(msLeft)}</span>
    </div>
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
}: {
  leaveId: string;
  docStatus: DocStatus | null;
  docUrl: string | null;
  requiredDoc: string;
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
    qc.invalidateQueries();
  }

  if (docStatus === "verified") return null;

  return (
    <div className="mt-3 rounded-lg border border-info/30 bg-info/8 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {docStatus === "uploaded" ? `✅ ${requiredDoc} uploaded` : `📄 Upload ${requiredDoc}`}
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
              📎 {selectedFile.name}
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
