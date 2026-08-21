/**
<<<<<<< HEAD
 * push.ts — Client-side Median / OneSignal bridge helpers
 *
 * After login (SIGNED_IN or INITIAL_SESSION), call initPush(userId).
 * Token is saved via a server fn so service_role bypasses RLS.
 */

import { createServerFn } from "@tanstack/react-start";

// ── Server fn: save token with service role (bypasses RLS) ───────────────────

export const savePushToken = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string; onesignalId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("push_tokens").upsert(
        {
          user_id:      data.userId,
          onesignal_id: data.onesignalId,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: "user_id,onesignal_id" },
      );
      if (error) console.error("[Push] savePushToken DB error:", error.message);
    } catch (err) {
      console.error("[Push] savePushToken error:", err);
    }
  });

// ── Client helpers ────────────────────────────────────────────────────────────

=======
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
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

<<<<<<< HEAD
function getMedianOnesignal(): any {
  return (window as any).median?.onesignal;
}

/**
 * Register device with OneSignal and save the subscription ID to Supabase.
 * Safe to call on every app open — re-saves on every INITIAL_SESSION.
 */
export function initPush(userId: string): void {
  if (!isMedianApp()) return;

  const os = getMedianOnesignal();
  if (!os) return;

  // Step 1: Link device to user identity in OneSignal
  os.login?.({ externalId: userId });

  // Step 2: Check current subscription state
  os.info?.({
    callback: async (info: {
      oneSignalUserId?: string;
      subscriptionId?: string;
      isSubscribed?: boolean;
      isPushDisabled?: boolean;
    }) => {
      const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;

      if (onesignalId && info?.isSubscribed !== false) {
        // Already subscribed — save/refresh token
        try {
          await savePushToken({ data: { userId, onesignalId } });
          console.log("[Push] Token saved:", onesignalId);
        } catch (err) {
          console.warn("[Push] Failed to save token:", err);
        }
        return;
      }

      // Not subscribed yet — prompt for permission
      os.promptNotification?.({
        callback: async (result: { granted: boolean }) => {
          if (!result?.granted) {
            console.log("[Push] Notification permission denied");
            return;
          }
          // Permission granted — get and save the subscription ID
          os.info?.({
            callback: async (info2: { oneSignalUserId?: string; subscriptionId?: string }) => {
              const id = info2?.subscriptionId ?? info2?.oneSignalUserId;
              if (id) {
                try {
                  await savePushToken({ data: { userId, onesignalId: id } });
                  console.log("[Push] Token saved after permission grant:", id);
                } catch (err) {
                  console.warn("[Push] Failed to save token after grant:", err);
                }
              }
            },
          });
        },
      });
=======
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
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
    },
  });
}

<<<<<<< HEAD
/** Unlink device from OneSignal on logout */
export function logoutPush(): void {
  if (!isMedianApp()) return;
  try {
    getMedianOnesignal()?.logout?.();
  } catch {}
}

/** Register global tap handler — Median calls this when user taps a notification */
=======
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
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
export function registerNotificationTapHandler(): void {
  if (typeof window === "undefined") return;
  (window as any).median_onesignal_push_opened = (data: {
    targetUrl?: string;
    openUrl?: string;
    additionalData?: Record<string, string>;
  }) => {
    const url = data?.targetUrl ?? data?.openUrl ?? data?.additionalData?.targetUrl;
<<<<<<< HEAD
    if (!url) return;
    const path = url.startsWith("http")
      ? new URL(url).pathname + new URL(url).search
      : url;
    window.location.href = path;
=======
    if (url) {
      const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
      window.location.href = path;
    }
>>>>>>> 120f8db681dae028de3aea90e5f418eb7ee9c6c5
  };
}
