'use server';
/**
 * push.functions.ts — Server-side OneSignal push notifications
 *
<<<<<<< HEAD
 * Contains:
 * - dispatchPush()        — plain async fn, call from any server context
 * - sendPushNotification  — createServerFn wrapper, called from client via useServerFn
 * - notify*()             — convenience wrappers that call dispatchPush directly
 *
 * NO 'use server' directive here — this file exports both a createServerFn
 * (which handles its own server boundary) and plain async fns.
=======
 * Env vars needed (no VITE_ prefix, server-only):
 *   ONESIGNAL_APP_ID
 *   ONESIGNAL_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
 */

import { createServerFn } from "@tanstack/react-start";

const OS_API = "https://onesignal.com/api/v1/notifications";

export interface PushPayload {
  userIds: string[];
  title: string;
  body: string;
  targetUrl?: string;
}

<<<<<<< HEAD
// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolvePlayerIds(userIds: string[]): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let profileIds: string[] = userIds.filter((id) => !id.startsWith("__"));
=======
// ── Core sender (plain async fn — callable from other server fns) ─────────────

/**
 * Resolve Supabase user IDs + sentinels → OneSignal subscription IDs
 * Uses service role so RLS is bypassed.
 */
async function resolveSubscriptionIds(userIds: string[]): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let profileIds = userIds.filter((id) => !id.startsWith("__"));
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
  const sentinels = userIds.filter((id) => id.startsWith("__"));

  for (const sentinel of sentinels) {
    const deptMatch = sentinel.match(/^__hod_dept_(.+)__$/);
    if (deptMatch) {
      // Resolve HOD by department
      const deptId = deptMatch[1];
      const { data: hodRoles } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", "hod");
      const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
      if (hodUserIds.length > 0) {
        const { data: deptHods } = await supabaseAdmin
          .from("profiles").select("id")
<<<<<<< HEAD
          .eq("department_id", deptId)
          .eq("approved", true)
=======
          .eq("department_id", deptId).eq("approved", true)
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
          .in("id", hodUserIds);
        profileIds = [...profileIds, ...(deptHods ?? []).map((r: any) => r.id)];
      }
    } else {
      // Resolve by role e.g. __principal__ → "principal"
      const role = sentinel.replace(/^__|__$/g, "");
      const { data: rows } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", role);
      profileIds = [...profileIds, ...(rows ?? []).map((r: any) => r.user_id)];
    }
  }

  if (profileIds.length === 0) return [];

<<<<<<< HEAD
  const unique = [...new Set(profileIds)];
  const { data: tokens, error } = await supabaseAdmin
=======
  const { data: tokens } = await supabaseAdmin
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
    .from("push_tokens")
    .select("onesignal_id")
    .in("user_id", unique);

  if (error) {
    console.error("[Push] push_tokens lookup error:", error.message);
    return [];
  }

  const ids = (tokens ?? []).map((t: any) => t.onesignal_id).filter(Boolean);
  console.log(`[Push] Resolved ${unique.length} user(s) → ${ids.length} player ID(s):`, ids);
  return ids;
}

<<<<<<< HEAD
// ─────────────────────────────────────────────────────────────────────────────
// Core sender — call this from any server context
// ─────────────────────────────────────────────────────────────────────────────

export async function dispatchPush(
  payload: PushPayload
): Promise<{ ok: boolean; error?: string }> {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;

  if (!appId || !apiKey) {
    console.warn("[Push] env vars missing");
    return { ok: false, error: "Push not configured" };
  }
  if (!payload.userIds?.length) {
    console.warn("[Push] no userIds provided");
    return { ok: false, error: "No recipients" };
  }

  const playerIds = await resolvePlayerIds(payload.userIds).catch((err) => {
    console.error("[Push] resolvePlayerIds threw:", err);
    return [] as string[];
  });

  if (playerIds.length === 0) {
    console.warn("[Push] No player IDs found for:", payload.userIds);
    return { ok: false, error: "No device tokens found" };
  }

  const requestBody: Record<string, unknown> = {
    app_id:              appId,
    include_player_ids:  playerIds,
    headings:            { en: payload.title },
    contents:            { en: payload.body },
    android_channel_id:  "csc-clms",
    android_accent_color: "FF2563EB",
    small_icon:          "ic_stat_notification",
  };

  if (payload.targetUrl) {
    requestBody.data = { targetUrl: payload.targetUrl };
  }

  console.log("[Push] Sending to", playerIds.length, "device(s):", payload.title);

  try {
    const res = await fetch(OS_API, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Key ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await res.text();

    if (!res.ok) {
      console.error("[Push] OneSignal rejected:", responseText);
      return { ok: false, error: responseText };
    }

    console.log("[Push] OneSignal accepted:", responseText);
    return { ok: true };
  } catch (err) {
    console.error("[Push] fetch threw:", err);
    return { ok: false, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TanStack server fn — called from client components via useServerFn
// ─────────────────────────────────────────────────────────────────────────────

export const sendPushNotification = createServerFn({ method: "POST" })
  .inputValidator((raw: PushPayload) => ({
    userIds:   (raw?.userIds ?? []).filter(Boolean).slice(0, 100) as string[],
    title:     String(raw?.title  ?? "").slice(0, 100),
    body:      String(raw?.body   ?? "").slice(0, 200),
    targetUrl: raw?.targetUrl ? String(raw.targetUrl).slice(0, 300) : undefined,
  }))
  .handler(async ({ data }) => {
    const result = await dispatchPush(data);
    if (!result.ok) console.error("[Push] sendPushNotification failed:", result.error);
    return result;
  });

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrappers — all call dispatchPush directly (not sendPushNotification)
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyLeaveSubmitted(
  hodIds: string[], teacherName: string, leaveType: string, days: number
) {
  const result = await dispatchPush({
    userIds:   hodIds,
    title:     "New Leave Request",
    body:      `${teacherName} applied for ${days} day(s) of ${leaveType} leave`,
    targetUrl: "/requests",
  });
  if (!result.ok) console.error("[Push] notifyLeaveSubmitted failed:", result.error);
}

export async function notifyLeaveApproved(
  teacherId: string, leaveType: string, days: number
) {
  const result = await dispatchPush({
    userIds:   [teacherId],
    title:     "Leave Approved ✓",
    body:      `Your ${leaveType} leave for ${days} day(s) has been approved`,
    targetUrl: "/leaves",
  });
  if (!result.ok) console.error("[Push] notifyLeaveApproved failed:", result.error);
}

export async function notifyLeaveRejected(
  teacherId: string, leaveType: string, reason?: string
) {
  const result = await dispatchPush({
    userIds:   [teacherId],
    title:     "Leave Rejected",
    body:      reason
      ? `Your ${leaveType} leave was rejected: ${reason}`
      : `Your ${leaveType} leave request was rejected`,
    targetUrl: "/leaves",
  });
  if (!result.ok) console.error("[Push] notifyLeaveRejected failed:", result.error);
}

export async function notifyProxyAssigned(
  proxyTeacherId: string, absenteeName: string, subject: string, date: string
) {
  const result = await dispatchPush({
    userIds:   [proxyTeacherId],
    title:     "Proxy Lecture Assigned",
    body:      `Cover ${subject} for ${absenteeName} on ${date}`,
    targetUrl: "/proxies",
  });
  if (!result.ok) console.error("[Push] notifyProxyAssigned failed:", result.error);
}

export async function notifyNewRegistration(
  adminIds: string[], staffName: string, role: string
) {
  const result = await dispatchPush({
=======
/**
 * Core push sender — plain async function, callable from ANY server context
 * (server fns, loaders, other server fns, cron jobs, etc.)
 */
export async function dispatchPush(payload: PushPayload): Promise<{ ok: boolean; error?: string }> {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;

  if (!appId || !apiKey) {
    console.warn("[Push] ONESIGNAL_APP_ID or ONESIGNAL_API_KEY not set");
    return { ok: false, error: "Push not configured" };
  }
  if (!payload.userIds?.length) return { ok: false, error: "No recipients" };

  let subscriptionIds: string[];
  try {
    subscriptionIds = await resolveSubscriptionIds(payload.userIds);
  } catch (err) {
    console.error("[Push] resolveSubscriptionIds failed:", err);
    return { ok: false, error: String(err) };
  }

  if (subscriptionIds.length === 0) {
    console.warn("[Push] No tokens found for userIds:", payload.userIds);
    return { ok: false, error: "No device tokens — users must open the app once to register" };
  }

  const body: Record<string, unknown> = {
    app_id:                   appId,
    include_player_ids: subscriptionIds,
    headings:                 { en: payload.title },
    contents:                 { en: payload.body },
    android_channel_id:       "csc-clms",
    android_accent_color:     "FF2563EB",
    small_icon:               "ic_stat_notification",
  };
  if (payload.targetUrl) body.data = { targetUrl: payload.targetUrl };

  try {
    const res = await fetch(OS_API, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("[Push] OneSignal error:", text);
      return { ok: false, error: text };
    }
    console.log("[Push] Sent ok to", subscriptionIds.length, "device(s)");
    return { ok: true };
  } catch (err) {
    console.error("[Push] fetch error:", err);
    return { ok: false, error: String(err) };
  }
}

// ── TanStack server fn wrapper — called from client via useServerFn ────────────

export const sendPushNotification = createServerFn({ method: "POST" })
  .inputValidator((data: PushPayload) => ({
    userIds:   (data?.userIds ?? []).filter(Boolean).slice(0, 100) as string[],
    title:     String(data?.title  ?? "").slice(0, 100),
    body:      String(data?.body   ?? "").slice(0, 200),
    targetUrl: data?.targetUrl ? String(data.targetUrl).slice(0, 300) : undefined,
  }))
  .handler(async ({ data }) => dispatchPush(data));

// ── Convenience wrappers (call dispatchPush directly — NOT sendPushNotification) ─

export async function notifyLeaveSubmitted(hodIds: string[], teacherName: string, leaveType: string, days: number) {
  return dispatchPush({
    userIds:   hodIds,
    title:     "New Leave Request",
    body:      `${teacherName} applied for ${days} day(s) of ${leaveType} leave`,
    targetUrl: "/requests",
  }).catch((e) => console.error("[Push] notifyLeaveSubmitted:", e));
}

export async function notifyLeaveApproved(teacherId: string, leaveType: string, days: number) {
  return dispatchPush({
    userIds:   [teacherId],
    title:     "Leave Approved ✓",
    body:      `Your ${leaveType} leave for ${days} day(s) has been approved`,
    targetUrl: "/leaves",
  }).catch((e) => console.error("[Push] notifyLeaveApproved:", e));
}

export async function notifyLeaveRejected(teacherId: string, leaveType: string, reason?: string) {
  return dispatchPush({
    userIds:   [teacherId],
    title:     "Leave Rejected",
    body:      reason ? `Your ${leaveType} leave was rejected: ${reason}` : `Your ${leaveType} leave request was rejected`,
    targetUrl: "/leaves",
  }).catch((e) => console.error("[Push] notifyLeaveRejected:", e));
}

export async function notifyProxyAssigned(proxyTeacherId: string, absenteeName: string, subject: string, date: string) {
  return dispatchPush({
    userIds:   [proxyTeacherId],
    title:     "Proxy Lecture Assigned",
    body:      `Cover ${subject} for ${absenteeName} on ${date}`,
    targetUrl: "/proxies",
  }).catch((e) => console.error("[Push] notifyProxyAssigned:", e));
}

export async function notifyNewRegistration(adminIds: string[], staffName: string, role: string) {
  return dispatchPush({
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
    userIds:   adminIds,
    title:     "New Registration Request",
    body:      `${staffName} registered as ${role} and is awaiting approval`,
    targetUrl: "/admin",
<<<<<<< HEAD
  });
  if (!result.ok) console.error("[Push] notifyNewRegistration failed:", result.error);
}

export async function notifyNewNotice(recipientIds: string[], noticeTitle: string) {
  const result = await dispatchPush({
=======
  }).catch((e) => console.error("[Push] notifyNewRegistration:", e));
}

export async function notifyNewNotice(recipientIds: string[], noticeTitle: string) {
  return dispatchPush({
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
    userIds:   recipientIds,
    title:     "New Notice",
    body:      noticeTitle,
    targetUrl: "/dashboard",
<<<<<<< HEAD
  });
  if (!result.ok) console.error("[Push] notifyNewNotice failed:", result.error);
}

export async function notifyHodApproved(
  principalIds: string[], teacherName: string, leaveType: string
) {
  const result = await dispatchPush({
=======
  }).catch((e) => console.error("[Push] notifyNewNotice:", e));
}

export async function notifyHodApproved(principalIds: string[], teacherName: string, leaveType: string) {
  return dispatchPush({
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
    userIds:   principalIds,
    title:     "Leave Awaiting Your Approval",
    body:      `${teacherName}'s ${leaveType} leave was approved by HOD and needs your sign-off`,
    targetUrl: "/requests",
<<<<<<< HEAD
  });
  if (!result.ok) console.error("[Push] notifyHodApproved failed:", result.error);
=======
  }).catch((e) => console.error("[Push] notifyHodApproved:", e));
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
}
