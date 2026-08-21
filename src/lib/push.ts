/**
 * push.ts — Client-side push registration
 *
 * Strategy:
 * 1. Try Median bridge to get subscription ID directly (fastest)
 * 2. Always also call /api/push-token?userId=X as fallback (server-side sync from OneSignal)
 *    This works even if the Median bridge callbacks never fire.
 */

export function isMedianApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).median !== "undefined";
}

function getOS(): any {
  return (window as any).median?.onesignal;
}

async function saveTokenViaPost(userId: string, onesignalId: string): Promise<void> {
  try {
    await fetch("/api/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, onesignalId }),
    });
  } catch {}
}

async function syncFromServer(userId: string): Promise<void> {
  try {
    await fetch(`/api/push-token?userId=${encodeURIComponent(userId)}`);
  } catch {}
}

export function initPush(userId: string): void {
  if (!isMedianApp()) return;

  const os = getOS();

  // Always sync from server after a short delay — this is the reliable fallback
  // Works even if Median bridge is not ready or callbacks never fire
  setTimeout(() => syncFromServer(userId), 3000);
  setTimeout(() => syncFromServer(userId), 10000); // retry once more

  if (!os) return;

  // Also try Median bridge directly (faster when it works)
  os.setExternalUserId?.(userId);
  os.login?.({ externalId: userId });

  os.info?.({
    callback: async (info: {
      oneSignalUserId?: string;
      subscriptionId?: string;
      isSubscribed?: boolean;
    }) => {
      const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;

      if (onesignalId && info?.isSubscribed !== false) {
        await saveTokenViaPost(userId, onesignalId);
        return;
      }

      // Not subscribed — prompt
      os.promptNotification?.({
        callback: async (result: { granted: boolean }) => {
          if (!result?.granted) return;
          setTimeout(() => {
            os.info?.({
              callback: async (info2: { oneSignalUserId?: string; subscriptionId?: string }) => {
                const id = info2?.subscriptionId ?? info2?.oneSignalUserId;
                if (id) await saveTokenViaPost(userId, id);
                else await syncFromServer(userId);
              },
            });
          }, 3000);
        },
      });
    },
  });
}

export function logoutPush(): void {
  if (!isMedianApp()) return;
  try { getOS()?.logout?.(); } catch {}
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
