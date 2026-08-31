/**
 * push.functions.ts — CLIENT SAFE
 *
 * Zero imports from any .server.ts file.
 * All push calls go via fetch() to /api/push-send (server-side endpoint).
 */

export interface PushPayload {
  userIds: string[];
  title: string;
  body: string;
  targetUrl?: string;
  excludeUserIds?: string[];
}

/**
 * firePush — fire-and-forget push notification from the client.
 * Uses a plain fetch() to /api/push-send so there are no TanStack
 * __report side-effects and no .server.ts files are touched by the client bundle.
 */
export function firePush(payload: PushPayload): void {
  fetch("/api/push-send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {}); // fully silent
}
