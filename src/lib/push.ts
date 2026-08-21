/**
 * push.ts — Pure client-side Median / OneSignal bridge
 * No TanStack imports here — token saving goes via plain fetch to /api/push-token
 */

export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

function getOS(): any {
  return (window as any).median?.onesignal;
}

async function saveToken(userId: string, onesignalId: string): Promise<void> {
  try {
    await fetch("/api/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, onesignalId }),
    });
    console.log("[Push] Token saved:", onesignalId);
  } catch (err) {
    console.warn("[Push] Failed to save token:", err);
  }
}

export function initPush(userId: string): void {
  if (!isMedianApp()) return;
  const os = getOS();
  if (!os) return;

  // Link device to user identity in OneSignal
  os.login?.({ externalId: userId });

  // Check current subscription state
  os.info?.({
    callback: async (info: {
      oneSignalUserId?: string;
      subscriptionId?: string;
      isSubscribed?: boolean;
    }) => {
      const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;

      if (onesignalId && info?.isSubscribed !== false) {
        // Already subscribed — refresh token
        await saveToken(userId, onesignalId);
        return;
      }

      // Not subscribed — request permission
      os.promptNotification?.({
        callback: async (result: { granted: boolean }) => {
          if (!result?.granted) {
            console.log("[Push] Permission denied");
            return;
          }
          // Get subscription ID after permission granted
          os.info?.({
            callback: async (info2: { oneSignalUserId?: string; subscriptionId?: string }) => {
              const id = info2?.subscriptionId ?? info2?.oneSignalUserId;
              if (id) await saveToken(userId, id);
            },
          });
        },
      });
    },
  });
}

export function logoutPush(): void {
  if (!isMedianApp()) return;
  try {
    getOS()?.logout?.();
  } catch {}
}

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
