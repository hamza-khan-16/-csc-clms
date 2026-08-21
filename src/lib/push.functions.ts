'use server';
/**
 * push.functions.ts — Server-side OneSignal push notifications
 *
 * Env vars needed (no VITE_ prefix, server-only):
 *   ONESIGNAL_APP_ID
 *   ONESIGNAL_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createServerFn } from "@tanstack/react-start";

const OS_API = "https://onesignal.com/api/v1/notifications";

export interface PushPayload {
  userIds: string[];
  title: string;
  body: string;
  targetUrl?: string;
}

// ── Core sender (plain async fn — callable from other server fns) ─────────────

/**
 * Resolve Supabase user IDs + sentinels → OneSignal subscription IDs
 * Uses service role so RLS is bypassed.
 */
async function resolveSubscriptionIds(userIds: string[]): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let profileIds = userIds.filter((id) => !id.startsWith("__"));
  const sentinels = userIds.filter((id) => id.startsWith("__"));

  for (const sentinel of sentinels) {
    const deptMatch = sentinel.match(/^__hod_dept_(.+)__$/);
    if (deptMatch) {
      const deptId = deptMatch[1];
      const { data: hodRoles } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", "hod");
      const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
      if (hodUserIds.length > 0) {
        const { data: deptHods } = await supabaseAdmin
          .from("profiles").select("id")
          .eq("department_id", deptId).eq("approved", true)
          .in("id", hodUserIds);
        profileIds = [...profileIds, ...(deptHods ?? []).map((r: any) => r.id)];
      }
    } else {
      const role = sentinel.replace(/__/g, "");
      const { data: rows } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", role);
      profileIds = [...profileIds, ...(rows ?? []).map((r: any) => r.user_id)];
    }
  }

  if (profileIds.length === 0) return [];

  const { data: tokens } = await supabaseAdmin
    .from("push_tokens")
    .select("onesignal_id")
    .in("user_id", [...new Set(profileIds)]);

  return (tokens ?? []).map((t: any) => t.onesignal_id).filter(Boolean);
}

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
    userIds:   adminIds,
    title:     "New Registration Request",
    body:      `${staffName} registered as ${role} and is awaiting approval`,
    targetUrl: "/admin",
  }).catch((e) => console.error("[Push] notifyNewRegistration:", e));
}

export async function notifyNewNotice(recipientIds: string[], noticeTitle: string) {
  return dispatchPush({
    userIds:   recipientIds,
    title:     "New Notice",
    body:      noticeTitle,
    targetUrl: "/dashboard",
  }).catch((e) => console.error("[Push] notifyNewNotice:", e));
}

export async function notifyHodApproved(principalIds: string[], teacherName: string, leaveType: string) {
  return dispatchPush({
    userIds:   principalIds,
    title:     "Leave Awaiting Your Approval",
    body:      `${teacherName}'s ${leaveType} leave was approved by HOD and needs your sign-off`,
    targetUrl: "/requests",
  }).catch((e) => console.error("[Push] notifyHodApproved:", e));
}
