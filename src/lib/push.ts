/**
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

export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

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
    },
  });
}

/** Unlink device from OneSignal on logout */
export function logoutPush(): void {
  if (!isMedianApp()) return;
  try {
    getMedianOnesignal()?.logout?.();
  } catch {}
}

/** Register global tap handler — Median calls this when user taps a notification */
export function registerNotificationTapHandler(): void {
  if (typeof window === "undefined") return;
  (window as any).median_onesignal_push_opened = (data: {
    targetUrl?: string;
    openUrl?: string;
    additionalData?: Record<string, string>;
  }) => {
    const url = data?.targetUrl ?? data?.openUrl ?? data?.additionalData?.targetUrl;
    if (!url) return;
    const path = url.startsWith("http")
      ? new URL(url).pathname + new URL(url).search
      : url;
    window.location.href = path;
  };
}
