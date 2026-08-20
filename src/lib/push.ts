/**
 * push.ts
 *
 * Client-side OneSignal / Median JavaScript Bridge helpers.
 *
 * Flow:
 *  1. After login (and on every INITIAL_SESSION), call initPush(userId).
 *     This links the device to the user in OneSignal and saves the
 *     OneSignal subscription ID to the push_tokens table.
 *  2. On logout, call logoutPush() — unlinks the device from the user.
 *
 * The actual notification sending happens server-side (push.functions.ts).
 */

import { supabase } from "@/integrations/supabase/client";

/** Returns true when running inside the Median app (not a plain browser) */
export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

/** Save OneSignal subscription ID to Supabase push_tokens */
async function saveToken(userId: string, onesignalId: string): Promise<void> {
  try {
    await supabase.from("push_tokens").upsert(
      { user_id: userId, onesignal_id: onesignalId, updated_at: new Date().toISOString() },
      { onConflict: "user_id,onesignal_id" },
    );
  } catch (err) {
    console.warn("Push: failed to save token:", err);
  }
}

/** Get OneSignal subscription info and save token */
function fetchAndSaveToken(median: any, userId: string): void {
  median?.onesignal?.info?.({
    callback: async (info: { oneSignalUserId?: string; subscriptionId?: string }) => {
      const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;
      if (onesignalId) {
        await saveToken(userId, onesignalId);
      }
    },
  });
}

/**
 * Register device with OneSignal and save subscription ID.
 * Safe to call on every app open — handles already-subscribed devices too.
 */
export async function initPush(userId: string): Promise<void> {
  if (!isMedianApp()) return;

  const median = (window as any).median;

  try {
    // 1. Link this device to the user's identity in OneSignal
    median?.onesignal?.login?.({ externalId: userId });

    // 2. Check if already subscribed — if so, just re-save the token
    //    (covers the "app resume" case where permission was already granted)
    median?.onesignal?.info?.({
      callback: async (info: { oneSignalUserId?: string; subscriptionId?: string; isSubscribed?: boolean }) => {
        const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;

        if (onesignalId && info?.isSubscribed !== false) {
          // Already subscribed — save/refresh token and done
          await saveToken(userId, onesignalId);
          return;
        }

        // 3. Not yet subscribed — prompt for permission
        median?.onesignal?.promptNotification?.({
          callback: async (result: { granted: boolean }) => {
            if (!result?.granted) return;
            // Permission granted — now get the subscription ID
            fetchAndSaveToken(median, userId);
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
      const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
      window.location.href = path;
    }
  };
}
