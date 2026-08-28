/**
 * download.ts
 *
 * Works in 3 environments:
 *   1. Desktop/mobile browser  → standard blob anchor click
 *   2. Median webview          → median.downloadFile() with a signed Supabase URL
 *   3. Webview without median  → fallback: open blob in new tab (user can long-press save)
 */

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

function isMedian(): boolean {
  const w = window as any;
  return !!(w.median?.downloadFile || w.gonative?.window?.open);
}

function isWebView(): boolean {
  const ua = navigator.userAgent;
  return (
    /wv/.test(ua) ||
    /WebView/.test(ua) ||
    ((/iPhone|iPod|iPad/.test(ua)) && !/Safari/.test(ua))
  );
}

/** Upload blob to Supabase temp-downloads bucket and return a signed URL. */
async function uploadAndSign(blob: Blob, filename: string): Promise<string> {
  const path = `temp/${Date.now()}_${filename}`;

  const { error: upErr } = await supabase.storage
    .from("temp-downloads")
    .upload(path, blob, { contentType: blob.type, upsert: true });

  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data, error: signErr } = await supabase.storage
    .from("temp-downloads")
    .createSignedUrl(path, 120);

  if (signErr || !data?.signedUrl)
    throw new Error(`Signed URL error: ${signErr?.message}`);

  // Cleanup after 3 min
  setTimeout(() => {
    supabase.storage.from("temp-downloads").remove([path]).catch(() => {});
  }, 3 * 60 * 1000);

  return data.signedUrl;
}

/** Trigger a blob download in a normal browser tab. */
function browserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  console.log("[download] isMedian:", isMedian(), "isWebView:", isWebView());

  if (isMedian()) {
    // Median native download
    const toastId = toast.loading("Preparing download…");
    try {
      const url = await uploadAndSign(blob, filename);
      (window as any).median.downloadFile({ url, filename });
      toast.success("Download started!", { id: toastId });
    } catch (err: any) {
      console.error("[download] Median path failed:", err);
      toast.error(`Download failed: ${err.message}`, { id: toastId });
    }
  } else if (isWebView()) {
    // Webview but no Median bridge — open in new tab as fallback
    const toastId = toast.loading("Opening file…");
    try {
      const url = await uploadAndSign(blob, filename);
      window.open(url, "_blank");
      toast.success("File opened — use your browser menu to save it.", { id: toastId });
    } catch (err: any) {
      console.error("[download] WebView fallback failed:", err);
      toast.error(`Download failed: ${err.message}`, { id: toastId });
    }
  } else {
    // Normal browser
    browserDownload(blob, filename);
    toast.success("Download started!");
  }
}

export async function savePDF(doc: any, filename: string): Promise<void> {
  const blob: Blob = doc.output("blob");
  await downloadBlob(blob, filename);
}

export async function saveXLSX(XLSX: any, wb: any, filename: string): Promise<void> {
  const buf: ArrayBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await downloadBlob(blob, filename);
}
