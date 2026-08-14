import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, CheckCircle2, Clock, XCircle, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

const DOCS = [
  {
    type: "degree",
    label: "Degree Certificate",
    description: "Your highest degree certificate (B.Ed, M.A., M.Sc., Ph.D., etc.)",
    required: true,
  },
  {
    type: "marksheet",
    label: "Marksheet",
    description: "Final year or consolidated marksheet for your highest degree",
    required: true,
  },
  {
    type: "salary_slip",
    label: "Previous Salary Slip",
    description: "Salary slip from your last employer (if applicable)",
    required: false,
  },
  {
    type: "experience_letter",
    label: "Experience Letter / Certificate",
    description: "Experience letter from previous institution (if applicable)",
    required: false,
  },
] as const;

type DocType = (typeof DOCS)[number]["type"];

interface DocRow {
  id: string;
  doc_type: DocType;
  file_path: string;
  original_name: string;
  status: "pending" | "approved" | "rejected";
  hr_note: string | null;
}

function StatusPill({ status }: { status: DocRow["status"] }) {
  if (status === "approved")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
        <CheckCircle2 className="size-3" /> Approved
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
        <XCircle className="size-3" /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
      <Clock className="size-3" /> Pending review
    </span>
  );
}

function DocCard({
  doc,
  existing,
  teacherId,
  onUploaded,
}: {
  doc: (typeof DOCS)[number];
  existing?: DocRow;
  teacherId: string;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${teacherId}/${doc.type}-${Date.now()}.${ext}`;

      // Delete old file if exists
      if (existing?.file_path) {
        await supabase.storage.from("hr-docs").remove([existing.file_path]);
      }

      const { error: uploadErr } = await supabase.storage
        .from("hr-docs")
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      // Upsert document record
      const { error: dbErr } = await supabase.from("teacher_documents").upsert(
        {
          teacher_id: teacherId,
          doc_type: doc.type,
          file_path: path,
          original_name: file.name,
          status: "pending",
          hr_note: null,
        },
        { onConflict: "teacher_id,doc_type" },
      );
      if (dbErr) throw dbErr;

      toast.success(`${doc.label} uploaded successfully`);
      onUploaded();
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3 transition-colors",
        existing?.status === "approved" && "border-success/40 bg-success/5",
        existing?.status === "rejected" && "border-destructive/40 bg-destructive/5",
        !existing && "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="size-4 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">
              {doc.label}
              {doc.required && <span className="ml-1 text-destructive">*</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{doc.description}</p>
          </div>
        </div>
        {existing && <StatusPill status={existing.status} />}
      </div>

      {existing && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FileText className="size-3" /> {existing.original_name}
        </p>
      )}

      {existing?.hr_note && existing.status === "rejected" && (
        <p className="text-xs text-destructive rounded bg-destructive/10 px-3 py-2">
          HR note: {existing.hr_note}
        </p>
      )}

      {/* Can't re-upload if already approved */}
      {existing?.status !== "approved" && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button
            size="sm"
            variant={existing ? "outline" : "default"}
            className="w-full"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <><Loader2 className="size-3.5 animate-spin mr-1.5" /> Uploading…</>
            ) : (
              <><Upload className="size-3.5 mr-1.5" /> {existing ? "Re-upload" : "Upload"}</>
            )}
          </Button>
        </>
      )}
    </div>
  );
}

function OnboardingPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data: docs = [] } = useQuery({
    queryKey: ["onboarding-docs", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_documents")
        .select("id, doc_type, file_path, original_name, status, hr_note")
        .eq("teacher_id", profile!.id);
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["onboarding-docs", profile?.id] });
  }

  const requiredUploaded = DOCS.filter((d) => d.required).every((d) =>
    docs.some((r) => r.doc_type === d.type),
  );

  const allApproved = docs.filter(d => d.status === "approved").length === DOCS.filter(d => d.required).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 py-10 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
            <FileText className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Upload Your Documents</h1>
          <p className="text-sm text-muted-foreground">
            Please upload the required documents below. HR will review them and unlock your
            account once everything is verified.
          </p>
        </div>

        {/* Status banner */}
        {profile?.hr_approved === null && requiredUploaded && (
          <div className="rounded-xl border border-info/40 bg-info/8 px-4 py-3 text-sm text-center space-y-1">
            <p className="font-semibold flex items-center justify-center gap-1.5">
              <Clock className="size-4" /> Documents submitted — awaiting HR review
            </p>
            <p className="text-xs text-muted-foreground">
              You will be notified once HR reviews your documents.
            </p>
          </div>
        )}

        {/* Doc cards */}
        <div className="space-y-3">
          {DOCS.map((d) => (
            <DocCard
              key={d.type}
              doc={d}
              existing={docs.find((r) => r.doc_type === d.type)}
              teacherId={profile?.id ?? ""}
              onUploaded={refresh}
            />
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Accepted formats: PDF, JPG, PNG, WEBP · Max 10 MB per file
          <br />
          <span className="text-destructive">*</span> Required documents
        </p>

        {!requiredUploaded && (
          <p className="text-center text-xs text-warning-foreground font-medium">
            Please upload all required documents before HR can review your profile.
          </p>
        )}
      </div>
    </div>
  );
}
