/**
 * push.ts
 *
 * Client-side OneSignal / Median JavaScript Bridge helpers.
 *
 * Flow:
 *  1. After login, call initPush(userId) — registers the device with OneSignal
 *     and saves the OneSignal subscription ID to Supabase push_tokens table.
 *  2. On logout, call logoutPush() — unlinks the device from the user.
 *
 * The actual notification sending happens server-side (push.functions.ts).
 * This file only handles the device registration side.
 */

import { supabase } from "@/integrations/supabase/client";

/** Returns true when running inside the Median app (not a plain browser) */
export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

/** Prompt for notification permission and register with OneSignal via Median bridge */
export async function initPush(userId: string): Promise<void> {
  if (!isMedianApp()) return;

  const median = (window as any).median;

  try {
    // Link this device to the user's identity in OneSignal
    median?.onesignal?.login?.({ externalId: userId });

    // Request permission (iOS shows system dialog; Android 13+ shows dialog)
    median?.onesignal?.promptNotification?.({
      callback: async (result: { granted: boolean }) => {
        if (!result?.granted) return;
        // Retrieve OneSignal subscription info and save to DB
        median?.onesignal?.info?.({
          callback: async (info: { oneSignalUserId?: string; subscriptionId?: string }) => {
            const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;
            if (!onesignalId) return;
            await supabase.from("push_tokens").upsert(
              { user_id: userId, onesignal_id: onesignalId, updated_at: new Date().toISOString() },
              { onConflict: "user_id,onesignal_id" },
            );
          },
        });
      },
    });
  } catch (err) {
    console.warn("Push init error:", err);
  }
}

/** Unlink this device from OneSignal on logout */
export function logoutPush(): void {
  if (!isMedianApp()) return;
  try {
    (window as any).median?.onesignal?.logout?.();
  } catch {}
}

/**
 * Handle notification tap — Median calls this global function when
 * user taps a push notification that has a targetUrl in its data.
 * We register it on window so the Median bridge can invoke it.
 */
export function registerNotificationTapHandler(): void {
  if (typeof window === "undefined") return;
  (window as any).median_onesignal_push_opened = (data: {
    targetUrl?: string;
    openUrl?: string;
    additionalData?: Record<string, string>;
  }) => {
    const url = data?.targetUrl ?? data?.openUrl ?? data?.additionalData?.targetUrl;
    if (url) {
      // Strip origin so we navigate within the app (not open external browser)
      const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
      window.location.href = path;
    }
  };
}
