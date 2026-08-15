import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuardedInput } from "@/components/GuardedField";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/leave";
import {
  CalendarDays, Plus, Trash2, Upload, Download, AlertCircle, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/holidays")({
  head: () => ({
    meta: [
      { title: "Holiday Calendar — CSC Leave Management" },
      { name: "description", content: "Indian public holidays. Upload a yearly Excel file or add custom holidays." },
      { property: "og:title", content: "Holiday Calendar — CSC Leave Management" },
    ],
  }),
  component: () => (
    <Guarded>
      <HolidaysPage />
    </Guarded>
  ),
});

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Excel date helper (Excel stores dates as numbers) ─────────────────────────
function excelDateToISO(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const s = value.trim();

    // DD-MM-YYYY  ← primary format (Excel auto-converts dates to this)
    const dmy1 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmy1) return `${dmy1[3]}-${dmy1[2].padStart(2,"0")}-${dmy1[1].padStart(2,"0")}`;

    // DD/MM/YYYY
    const dmy2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy2) return `${dmy2[3]}-${dmy2[2].padStart(2,"0")}-${dmy2[1].padStart(2,"0")}`;

    // YYYY-MM-DD  (ISO — still supported)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // DD-MMM-YYYY  e.g. "26-Jan-2026"
    const abbr = s.match(/^(\d{1,2})[- ]([A-Za-z]+)[- ](\d{4})$/);
    if (abbr) {
      const months: Record<string, string> = {
        jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
        jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
      };
      const m = months[abbr[2].toLowerCase().slice(0,3)];
      if (m) return `${abbr[3]}-${m}-${abbr[1].padStart(2,"0")}`;
    }

    // Native Date parse as last resort
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }
    return null;
  }

  // Excel serial number
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2,"0")}-${String(date.d).padStart(2,"0")}`;
    }
  }

  return null;
}

// ── Parse uploaded Excel/CSV into holiday rows ────────────────────────────────
function parseHolidaySheet(workbook: XLSX.WorkBook): {
  rows: { holiday_date: string; occasion: string; kind: string }[];
  errors: string[];
} {
  const rows: { holiday_date: string; occasion: string; kind: string }[] = [];
  const errors: string[] = [];

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) { errors.push("No sheets found in the file"); return { rows, errors }; }

  const ws = workbook.Sheets[sheetName];
  // raw: true keeps numbers as numbers (for date serials)
  const data: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { raw: true, defval: "" });

  if (data.length === 0) { errors.push("Sheet is empty"); return { rows, errors }; }

  // Normalise column names — case-insensitive, trim spaces
  const normalise = (key: string) => key.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "");

  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    const row: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) row[normalise(k)] = raw[k];

    // Find Date column: "date", "holiday_date", "holiday date"
    const dateVal = row["date"] ?? row["holiday_date"] ?? row["holiday_date"] ?? row["holiday"];
    // Find Occasion column: "occasion", "name", "holiday_name", "description"
    const occVal  = row["occasion"] ?? row["name"] ?? row["holiday_name"] ?? row["description"] ?? row["event"];
    // Find Kind column: "kind", "type", "category" — optional, defaults to National
    const kindVal = row["kind"] ?? row["type"] ?? row["category"] ?? "National";

    const iso = excelDateToISO(dateVal);
    const occ = String(occVal ?? "").trim();

    if (!iso) {
      errors.push(`Row ${i + 2}: Could not parse date "${dateVal}" — skipped`);
      continue;
    }
    if (!occ) {
      errors.push(`Row ${i + 2}: Missing occasion/name — skipped`);
      continue;
    }
    // Basic date range guard
    const year = parseInt(iso.slice(0, 4), 10);
    if (year < 2020 || year > 2035) {
      errors.push(`Row ${i + 2}: Date ${iso} is out of expected range (2020–2035) — skipped`);
      continue;
    }

    rows.push({ holiday_date: iso, occasion: occ, kind: String(kindVal).trim() || "National" });
  }

  return { rows, errors };
}

// ── Generate the 2026 reference document ─────────────────────────────────────
function downloadReferenceDoc() {
  // DD-MM-YYYY format — matches what Excel auto-displays when you type dates
  const rows2026 = [
    ["Date",        "Occasion",                              "Kind"    ],
    ["14-01-2026", "Makar Sankranti / Pongal",              "National"],
    ["23-01-2026", "Netaji Subhas Chandra Bose Jayanti",    "National"],
    ["26-01-2026", "Republic Day",                          "National"],
    ["15-02-2026", "Maha Shivratri",                        "National"],
    ["04-03-2026", "Holi",                                  "National"],
    ["20-03-2026", "Id-ul-Fitr (Eid al-Fitr)",              "National"],
    ["26-03-2026", "Ram Navami",                            "National"],
    ["30-03-2026", "Mahavir Jayanti",                       "National"],
    ["03-04-2026", "Good Friday",                           "National"],
    ["14-04-2026", "Dr. B.R. Ambedkar Jayanti",             "National"],
    ["30-04-2026", "Buddha Purnima",                        "National"],
    ["01-05-2026", "Maharashtra Day",                       "State"   ],
    ["27-05-2026", "Id-ul-Zuha (Bakrid)",                   "National"],
    ["16-06-2026", "Muharram",                              "National"],
    ["14-07-2026", "College Foundation Day",                "College" ],
    ["15-08-2026", "Independence Day",                      "National"],
    ["25-08-2026", "Raksha Bandhan",                        "National"],
    ["26-08-2026", "Janmashtami",                           "National"],
    ["09-09-2026", "Id-e-Milad (Milad-un-Nabi)",            "National"],
    ["02-10-2026", "Gandhi Jayanti",                        "National"],
    ["19-10-2026", "Dussehra (Vijaya Dashami)",             "National"],
    ["08-11-2026", "Diwali (Lakshmi Puja)",                "National"],
    ["24-11-2026", "Guru Nanak Jayanti",                    "National"],
    ["25-12-2026", "Christmas Day",                         "National"],
  ];

  const instrRows = [
    ["CSC Leave Management System — Holiday Upload Format"],
    [""],
    ["HOW TO USE THIS FILE:"],
    ["1. Use the sheet named  Upload Template (clean)  when uploading."],
    ["2. DATE FORMAT: DD-MM-YYYY  (e.g. 26-01-2026 for Republic Day)"],
    ["   Excel will show dates in this format automatically — keep it as-is."],
    ["3. Column headers must be exactly: Date | Occasion | Kind"],
    ["4. Kind values: National | State | College   (defaults to National if blank)"],
    ["5. Each date must be unique. If two rows have the same date, the last one wins."],
    ["6. Sundays are excluded from leave counts automatically — no need to list them."],
    ["7. You can add your own college holidays — just add rows with Kind = College"],
    [""],
    ["COLUMN DESCRIPTIONS:"],
    ["Date     — DD-MM-YYYY format. Required."],
    ["Occasion — Name of the holiday. Required."],
    ["Kind     — National / State / College. Optional."],
    [""],
    ...rows2026,
  ];

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(instrRows);
  ws1["!cols"] = [{ wch: 16 }, { wch: 46 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Instructions & 2026 Data");

  const ws2 = XLSX.utils.aoa_to_sheet(rows2026);
  ws2["!cols"] = [{ wch: 14 }, { wch: 44 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Upload Template (clean)");

  XLSX.writeFile(wb, "CSC_Holiday_Format_2026.xlsx");
  toast.success("Format document downloaded — use 'Upload Template (clean)' sheet for uploading");
}

// ── Main page ─────────────────────────────────────────────────────────────────
function HolidaysPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const isPrincipalOrAdmin = role === "principal" || role === "admin";
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const [viewYear, setViewYear]   = useState(currentYear);
  const [addOpen, setAddOpen]     = useState(false);
  const [form, setForm]           = useState({ date: "", occasion: "", kind: "College" });

  // Excel upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]         = useState(false);
  const [uploadPreview, setUploadPreview] = useState<{
    rows: { holiday_date: string; occasion: string; kind: string }[];
    errors: string[];
    year: number | null;
  } | null>(null);

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays", viewYear],
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("id, holiday_date, occasion, kind, source")
        .gte("holiday_date", `${viewYear}-01-01`)
        .lte("holiday_date", `${viewYear}-12-31`)
        .order("holiday_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["holidays"] });
    qc.invalidateQueries({ queryKey: ["holidays-all"] });
    qc.invalidateQueries({ queryKey: ["upcoming-holidays"] });
    qc.invalidateQueries({ queryKey: ["month-calendar"] });
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["monthly-schedule"] });
  }

  // ── Handle file selection — parse and preview, don't upload yet ────────────
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data  = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb    = XLSX.read(data, { type: "array", cellDates: false });
        const { rows, errors } = parseHolidaySheet(wb);

        // Detect year from the data
        const year = rows.length > 0 ? parseInt(rows[0].holiday_date.slice(0, 4), 10) : null;

        setUploadPreview({ rows, errors, year });
      } catch (err) {
        toast.error(`Could not read file: ${String(err)}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Confirm upload — wipe old uploaded rows for that year, insert new ──────
  async function confirmUpload() {
    if (!uploadPreview || uploadPreview.rows.length === 0) return;
    setUploading(true);

    const year = uploadPreview.year ?? viewYear;

    try {
      // Delete existing 'upload' and 'system' source rows for that year
      // Keep 'manual' rows the principal added individually
      const { error: delErr } = await supabase
        .from("holidays")
        .delete()
        .gte("holiday_date", `${year}-01-01`)
        .lte("holiday_date", `${year}-12-31`)
        .in("source", ["upload", "system"]);

      if (delErr) throw delErr;

      // Insert all parsed rows as source='upload' so they override system defaults
      const toInsert = uploadPreview.rows.map((r) => ({
        ...r,
        source: "upload",
      }));

      // Deduplicate by date (keep last occurrence) before inserting
      const deduped = Object.values(
        Object.fromEntries(toInsert.map((r) => [r.holiday_date, r]))
      );

      const { error: insErr } = await supabase
        .from("holidays")
        .upsert(deduped, { onConflict: "holiday_date" });

      if (insErr) throw insErr;

      toast.success(
        `Uploaded ${deduped.length} holidays for ${year}. They override the default calendar for this year.`
      );
      setUploadPreview(null);
      setViewYear(year);
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function cancelUpload() {
    setUploadPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Add custom holiday ─────────────────────────────────────────────────────
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date || !form.occasion.trim()) return toast.error("Date and occasion are required");
    const { error } = await supabase.from("holidays").upsert(
      { holiday_date: form.date, occasion: form.occasion.trim(), kind: form.kind, source: "manual" },
      { onConflict: "holiday_date" },
    );
    if (error) return toast.error(error.message);
    setForm({ date: "", occasion: "", kind: "College" });
    setAddOpen(false);
    toast.success("Holiday added — will be excluded from leave counts immediately");
    invalidateAll();
  }

  // ── Remove holiday ─────────────────────────────────────────────────────────
  async function remove(id: string, source: string) {
    if (source === "system") {
      if (!window.confirm("This is a pre-loaded national holiday. Remove it?")) return;
    }
    const { error } = await supabase.from("holidays").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Holiday removed");
    invalidateAll();
  }

  // holidays are already sorted by holiday_date from the query

  const upcoming  = holidays.filter((h) => h.holiday_date >= today && h.holiday_date.startsWith(String(currentYear)));
  const hasUpload = holidays.some((h) => (h as any).source === "upload");

  return (
    <AppShell
      title="Holiday Calendar"
      subtitle="Manage public and college holidays · affects leave calculations everywhere"
    >
      <div className="space-y-5">

        {/* ── Admin: Excel upload section ─────────────────────────────────── */}
        {isAdmin && (
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">Upload Holiday List</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upload an Excel or CSV file to override the default holidays for a year. Manually-added holidays are preserved.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {/* Download format reference */}
                <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={downloadReferenceDoc}>
                  <Download className="size-3.5" />
                  <span className="hidden xs:inline">Format reference (2026)</span>
                  <span className="xs:hidden">Format</span>
                </Button>
                {/* Upload trigger */}
                <Button size="sm" className="gap-1.5 h-8" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-3.5" />
                  <span className="hidden xs:inline">Upload Excel / CSV</span>
                  <span className="xs:hidden">Upload</span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.ods"
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>
            </div>

            {/* Upload indicator */}
            {hasUpload && !uploadPreview && (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-xs text-success">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>Custom holiday file is active for {viewYear}. Uploaded holidays override default list for this year.</span>
              </div>
            )}

            {/* Format hint */}
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground mb-1">Required column headers (case-insensitive):</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                <p><code className="bg-background rounded px-1">Date</code> — DD-MM-YYYY <span className="text-destructive font-medium">required</span></p>
                <p><code className="bg-background rounded px-1">Occasion</code> — Holiday name <span className="text-destructive font-medium">required</span></p>
                <p><code className="bg-background rounded px-1">Kind</code> — National / State / College <em className="text-muted-foreground">(optional, defaults to National)</em></p>
              </div>
            </div>

            {/* Preview panel after file is parsed */}
            {uploadPreview && (
              <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">
                    Preview — {uploadPreview.rows.length} holiday(s) found
                    {uploadPreview.year && ` for ${uploadPreview.year}`}
                  </p>
                  <button onClick={cancelUpload} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>

                {/* Parse errors */}
                {uploadPreview.errors.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                    <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                      <AlertCircle className="size-3.5" />
                      {uploadPreview.errors.length} row(s) skipped
                    </p>
                    <ul className="space-y-0.5">
                      {uploadPreview.errors.map((e, i) => (
                        <li key={i} className="text-xs text-destructive">{e}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {uploadPreview.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No valid rows to upload. Check the format and try again.</p>
                ) : (
                  <>
                    {/* Preview table */}
                    <div className="rounded-lg border border-border overflow-hidden max-h-64 overflow-y-auto overflow-x-auto">
                      <table className="w-full text-xs min-w-[320px]">
                        <thead className="sticky top-0 bg-muted/80">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">#</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Occasion</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Kind</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uploadPreview.rows.map((r, i) => (
                            <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                              <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                              <td className="px-3 py-1.5 font-medium">{fmtDate(r.holiday_date)}</td>
                              <td className="px-3 py-1.5">{r.occasion}</td>
                              <td className="px-3 py-1.5">
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{r.kind}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Warning about override */}
                    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs">
                      <AlertCircle className="size-3.5 text-warning-foreground shrink-0 mt-0.5" />
                      <p className="text-warning-foreground">
                        This will <strong>replace all system/uploaded holidays</strong> for{" "}
                        {uploadPreview.year ?? viewYear}. Manually added holidays are kept.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={confirmUpload} disabled={uploading} className="gap-1.5">
                        <Upload className="size-3.5" />
                        {uploading ? "Uploading…" : `Confirm — upload ${uploadPreview.rows.length} holidays`}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelUpload}>Cancel</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Year nav + stats ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{holidays.length}</strong> holidays in {viewYear}
            {upcoming.length > 0 && viewYear === currentYear && (
              <> · <strong className="text-foreground">{upcoming.length}</strong> upcoming</>
            )}
            {hasUpload && (
              <span className="ml-2 text-success font-medium text-xs">· Custom file active</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewYear((y) => y - 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              ‹ {viewYear - 1}
            </button>
            <span className="font-bold text-sm w-12 text-center">{viewYear}</span>
            <button
              onClick={() => setViewYear((y) => y + 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
            >
              {viewYear + 1} ›
            </button>
          </div>
        </div>

        {/* ── Upcoming strip ────────────────────────────────────────────────── */}
        {upcoming.length > 0 && (
          <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Next upcoming</p>
            <div className="flex flex-wrap gap-2">
              {upcoming.slice(0, 5).map((h) => (
                <div key={h.id} className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-background px-3 py-1.5 text-xs">
                  <CalendarDays className="size-3 text-primary shrink-0" />
                  <span className="font-medium">{h.occasion}</span>
                  <span className="text-muted-foreground">{fmtDate(h.holiday_date)}</span>
                </div>
              ))}
              {upcoming.length > 5 && (
                <span className="flex items-center text-xs text-muted-foreground px-2">+{upcoming.length - 5} more</span>
              )}
            </div>
          </div>
        )}

        {/* ── Year-wise flat list ───────────────────────────────────────────── */}
        {isLoading ? (
          <div className="rounded-xl border border-border p-12 text-center">
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          </div>
        ) : holidays.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <Empty>No holidays for {viewYear}.</Empty>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Year heading */}
            <div className="bg-muted/60 px-5 py-3 border-b border-border flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">{viewYear} Holidays</p>
              <span className="text-xs text-muted-foreground">{holidays.length} total</span>
            </div>
            <ul className="divide-y divide-border">
              {holidays.map((h) => {
                const d       = new Date(h.holiday_date + "T00:00:00");
                const day     = d.getDate();
                const month   = MONTH_NAMES[d.getMonth()];
                const year    = d.getFullYear();
                const dayFull = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
                const isPast  = h.holiday_date < today;
                const src     = (h as any).source ?? "system";
                const isUpload = src === "upload";
                const isManual = src === "manual";
                return (
                  <li key={h.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 group transition-colors hover:bg-muted/20 sm:flex-nowrap sm:px-5 ${isPast ? "opacity-50" : ""}`}>
                    {/* Date block */}
                    <div className="shrink-0 flex items-baseline gap-1.5 min-w-[120px] sm:w-36">
                      <span className="text-sm font-bold tabular-nums">
                        {String(day).padStart(2, "0")} {month} {year}
                      </span>
                      <span className="text-xs text-muted-foreground sm:hidden"> · {dayFull}</span>
                    </div>
                    {/* Day name - desktop only */}
                    <div className="hidden shrink-0 w-24 sm:block">
                      <span className="text-sm text-muted-foreground">{dayFull}</span>
                    </div>
                    {/* Occasion */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{h.occasion}</p>
                    </div>
                    {isPrincipalOrAdmin && (
                      <button
                        onClick={() => remove(h.id, src)}
                        className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/8 transition-all"
                        title="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ── Add custom holiday — principal/admin ──────────────────────────── */}
        {isPrincipalOrAdmin && !uploadPreview && (
          <div>
            {!addOpen ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" /> Add custom holiday
              </Button>
            ) : (
              <div className="rounded-xl border border-border p-5 space-y-4 max-w-md">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">Add custom holiday</p>
                  <button onClick={() => setAddOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
                <form onSubmit={add} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" className="h-9 text-sm" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Occasion</Label>
                    <GuardedInput fieldName="Occasion" className="h-9 text-sm" placeholder="e.g. College Foundation Day" value={form.occasion} onChange={(v) => setForm({ ...form, occasion: v })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                      <option value="College">College</option>
                      <option value="State">State</option>
                      <option value="National">National</option>
                    </select>
                  </div>
                  <Button type="submit" size="sm" className="w-full">Add holiday</Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  This holiday will appear in the calendar immediately and will be excluded from leave day counts.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Legend ────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success/60 inline-block" /> National (default)</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-violet-400/60 inline-block" /> Uploaded from Excel</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-info/60 inline-block" /> Custom / college</span>
        </div>
      </div>
    </AppShell>
  );
}
