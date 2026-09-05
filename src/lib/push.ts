/**
 * push.ts — Client-side push registration
 *
 * Key design decisions:
 * - logoutPush() is called BEFORE initPush() to ensure the device is cleanly
 *   unlinked from the previous user before being linked to the new one.
 * - The server-side sync (/api/push-token GET) is the primary registration method.
 *   The Median bridge callbacks are unreliable, so we don't depend on them.
 * - A debounce prevents initPush from firing multiple times during session restore.
 */

let pendingInit: ReturnType<typeof setTimeout> | null = null;
let lastUserId: string | null = null;

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
  } catch (e) { if (process.env.NODE_ENV==="development") console.warn("[push]",e); }
}

async function syncFromServer(userId: string): Promise<void> {
  try {
    await fetch(`/api/push-token?userId=${encodeURIComponent(userId)}`);
  } catch (e) { if (process.env.NODE_ENV==="development") console.warn("[push]",e); }
}

export function initPush(userId: string): void {
  if (!isMedianApp()) return;

  // Debounce — if called multiple times quickly (session restore flash),
  // only run for the final userId
  if (pendingInit) clearTimeout(pendingInit);

  pendingInit = setTimeout(async () => {
    pendingInit = null;

    // If same user as last time, no need to re-link
    if (lastUserId === userId) {
      // Still sync in case token changed
      await syncFromServer(userId);
      return;
    }

    // New user — unlink previous device association first
    if (lastUserId) {
      const os = getOS();
      os?.logout?.();
      await new Promise((r) => setTimeout(r, 500));
    }

    lastUserId = userId;

    const os = getOS();
    if (os) {
      // Re-link device to new user in OneSignal
      os.login?.({ externalId: userId });
      await new Promise((r) => setTimeout(r, 1000));

      // Try getting subscription ID directly from bridge
      os.info?.({
        callback: async (info: {
          oneSignalUserId?: string;
          subscriptionId?: string;
          isSubscribed?: boolean;
        }) => {
          const onesignalId = info?.subscriptionId ?? info?.oneSignalUserId;

          if (onesignalId && info?.isSubscribed !== false) {
            await saveTokenViaPost(userId, onesignalId);
          } else if (!onesignalId) {
            // Prompt for permission if not subscribed
            os.promptNotification?.({
              callback: async (result: { granted: boolean }) => {
                if (!result?.granted) return;
                await new Promise((r) => setTimeout(r, 2000));
                os.info?.({
                  callback: async (info2: { oneSignalUserId?: string; subscriptionId?: string }) => {
                    const id = info2?.subscriptionId ?? info2?.oneSignalUserId;
                    if (id) await saveTokenViaPost(userId, id);
                  },
                });
              },
            });
          }
        },
      });
    }

    // Always also sync server-side — most reliable path
    await syncFromServer(userId);

  }, 1500); // 1.5s debounce — waits for session restore to settle
}

export function logoutPush(): void {
  if (!isMedianApp()) return;
  lastUserId = null;
  if (pendingInit) {
    clearTimeout(pendingInit);
    pendingInit = null;
  }
  try { getOS()?.logout?.(); } catch (e) { if (process.env.NODE_ENV==="development") console.warn("[push logout]",e); }
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
