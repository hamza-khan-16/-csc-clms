/**
 * push.ts — Pure client-side Median / OneSignal bridge
 * No TanStack imports — token saving via plain fetch to /api/push-token
 */

export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

function getOS(): any {
  return (window as any).median?.onesignal;
}

async function saveTokenViaApi(userId: string, onesignalId: string): Promise<void> {
  try {
    const res = await fetch("/api/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, onesignalId }),
    });
    const data = await res.json();
    if (data.ok) console.log("[Push] Token saved via POST:", onesignalId);
    else console.warn("[Push] POST failed:", data.error);
  } catch (err) {
    console.warn("[Push] POST fetch error:", err);
  }
}

async function syncTokenFromOneSignal(userId: string): Promise<void> {
  try {
    const res = await fetch(`/api/push-token?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (data.ok) console.log("[Push] Synced", data.synced, "token(s) from OneSignal");
    else console.warn("[Push] Sync failed:", data.error);
  } catch (err) {
    console.warn("[Push] Sync fetch error:", err);
  }
}

export function initPush(userId: string): void {
  if (!isMedianApp()) return;
  const os = getOS();
  if (!os) {
    // Median bridge not ready yet — retry after 2s
    setTimeout(() => initPush(userId), 2000);
    return;
  }

  // Step 1: Link this device to the user in OneSignal
  os.setExternalUserId?.(userId);
  os.login?.({ externalId: userId });

  // Step 2: Try to get subscription ID from Median bridge
  os.info?.({
    callback: async (info: {
      oneSignalUserId?: string;
      subscriptionId?: string;
      isSubscribed?: boolean;
    }) => {
      const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;

      if (onesignalId && info?.isSubscribed !== false) {
        // Got it directly — save via POST
        await saveTokenViaApi(userId, onesignalId);
        return;
      }

      if (!onesignalId) {
        // Bridge didn't return an ID — prompt for permission first
        os.promptNotification?.({
          callback: async (result: { granted: boolean }) => {
            if (!result?.granted) {
              console.log("[Push] Permission denied");
              return;
            }
            // After permission, wait a moment then try bridge again
            setTimeout(async () => {
              os.info?.({
                callback: async (info2: { oneSignalUserId?: string; subscriptionId?: string }) => {
                  const id = info2?.subscriptionId ?? info2?.oneSignalUserId;
                  if (id) {
                    await saveTokenViaApi(userId, id);
                  } else {
                    // Bridge still not returning ID — sync from OneSignal server-side
                    await syncTokenFromOneSignal(userId);
                  }
                },
              });
            }, 3000);
          },
        });
        return;
      }

      // isSubscribed is false — user disabled notifications
      console.log("[Push] User has notifications disabled");
    },
  });

  // Step 3: Also always attempt a server-side sync after login
  // This is the most reliable fallback — works even if the bridge callbacks fail
  setTimeout(() => syncTokenFromOneSignal(userId), 5000);
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
