/**
 * push.functions.ts
 *
 * Contains:
 * - dispatchPush()        — plain async fn, call from any server context
 * - sendPushNotification  — createServerFn wrapper, called from client via useServerFn
 * - notify*()             — convenience wrappers that call dispatchPush directly
 *
 * NO 'use server' directive here — this file exports both a createServerFn
 * (which handles its own server boundary) and plain async fns.
 */

import { createServerFn } from "@tanstack/react-start";

const OS_API = "https://onesignal.com/api/v1/notifications";

export interface PushPayload {
  userIds: string[];
  title: string;
  body: string;
  targetUrl?: string;
  excludeUserIds?: string[]; // user IDs to exclude (e.g. the sender)
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolvePlayerIds(userIds: string[], excludeUserIds: string[] = []): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let profileIds: string[] = userIds.filter((id) => !id.startsWith("__"));
  const sentinels = userIds.filter((id) => id.startsWith("__"));

  for (const sentinel of sentinels) {
    const deptMatch = sentinel.match(/^__hod_dept_(.+)__$/);
    const deptTeachersMatch = sentinel.match(/^__dept_teachers_(.+)__$/);
    if (deptTeachersMatch) {
      // All teachers in a specific department
      const deptId = deptTeachersMatch[1];
      const { data: teachers } = await supabaseAdmin
        .from("profiles").select("id")
        .eq("department_id", deptId)
        .eq("approved", true);
      profileIds = [...profileIds, ...(teachers ?? []).map((r: any) => r.id)];
    } else if (deptMatch) {
      // Resolve HOD by department
      const deptId = deptMatch[1];
      const { data: hodRoles } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", "hod");
      const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
      if (hodUserIds.length > 0) {
        const { data: deptHods } = await supabaseAdmin
          .from("profiles").select("id")
          .eq("department_id", deptId)
          .eq("approved", true)
          .in("id", hodUserIds);
        profileIds = [...profileIds, ...(deptHods ?? []).map((r: any) => r.id)];
      }
    } else {
      // Resolve by role e.g. __principal__ → "principal"
      const role = sentinel.replace(/^__|__$/g, "");
      const { data: rows } = await (supabaseAdmin as any)
        .from("user_roles").select("user_id").eq("role", role);
      profileIds = [...profileIds, ...(rows ?? []).map((r: any) => r.user_id)];
    }
  }

  if (profileIds.length === 0) return [];

  const unique = [...new Set(profileIds)].filter((id) => !excludeUserIds.includes(id));
  const { data: tokens, error } = await (supabaseAdmin as any)
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

  const playerIds = await resolvePlayerIds(payload.userIds, payload.excludeUserIds ?? []).catch((err) => {
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
    android_channel_id:   "69e5e20c-9520-4afe-a46e-611bbcd905bc",
    android_accent_color: "FF2563EB",
    small_icon:           "ic_stat_notification",
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
    userIds:        (raw?.userIds ?? []).filter(Boolean).slice(0, 100) as string[],
    title:          String(raw?.title  ?? "").slice(0, 100),
    body:           String(raw?.body   ?? "").slice(0, 200),
    targetUrl:      raw?.targetUrl ? String(raw.targetUrl).slice(0, 300) : undefined,
    excludeUserIds: (raw?.excludeUserIds ?? []).filter(Boolean).slice(0, 50) as string[],
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
    userIds:   adminIds,
    title:     "New Registration Request",
    body:      `${staffName} registered as ${role} and is awaiting approval`,
    targetUrl: "/admin",
  });
  if (!result.ok) console.error("[Push] notifyNewRegistration failed:", result.error);
}

export async function notifyNewNotice(recipientIds: string[], noticeTitle: string) {
  const result = await dispatchPush({
    userIds:   recipientIds,
    title:     "New Notice",
    body:      noticeTitle,
    targetUrl: "/dashboard",
  });
  if (!result.ok) console.error("[Push] notifyNewNotice failed:", result.error);
}

export async function notifyHodApproved(
  principalIds: string[], teacherName: string, leaveType: string
) {
  const result = await dispatchPush({
    userIds:   principalIds,
    title:     "Leave Awaiting Your Approval",
    body:      `${teacherName}'s ${leaveType} leave was approved by HOD and needs your sign-off`,
    targetUrl: "/requests",
  });
  if (!result.ok) console.error("[Push] notifyHodApproved failed:", result.error);
}
