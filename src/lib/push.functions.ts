/**
 * push.functions.ts
 *
 * Server-side OneSignal REST API calls.
 * Required env vars (server-only, no VITE_ prefix):
 *   ONESIGNAL_APP_ID=<your_app_id>
 *   ONESIGNAL_API_KEY=<your_rest_api_key>
 *
 * Targeting strategy: looks up onesignal_id values from the push_tokens table
 * and uses include_subscription_ids — works on all OneSignal plans including free.
 */

import { createServerFn } from "@tanstack/react-start";

const OS_API = "https://onesignal.com/api/v1/notifications";

export interface PushPayload {
  /** Supabase profile IDs to target (resolved to OneSignal subscription IDs via push_tokens) */
  userIds: string[];
  title: string;
  body: string;
  /** Deep-link path inside the app, e.g. "/requests" or "/dashboard" */
  targetUrl?: string;
}

/**
 * Resolve Supabase user IDs (including __role__ sentinels) to
 * OneSignal subscription IDs via the push_tokens table.
 */
async function resolveSubscriptionIds(userIds: string[]): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. Separate plain IDs from sentinels
  let profileIds = userIds.filter((id) => !id.startsWith("__"));
  const sentinels = userIds.filter((id) => id.startsWith("__"));

  // 2. Resolve sentinels → profile IDs
  for (const sentinel of sentinels) {
    const deptMatch = sentinel.match(/^__hod_dept_(.+)__$/);
    if (deptMatch) {
      const deptId = deptMatch[1];
      const { data: hodRoles } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", "hod");
      const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
      const { data: deptHods } = await supabaseAdmin
        .from("profiles").select("id")
        .eq("department_id", deptId).eq("approved", true)
        .in("id", hodUserIds);
      profileIds = [...profileIds, ...(deptHods ?? []).map((r: any) => r.id)];
    } else {
      const role = sentinel.replace(/__/g, "");
      const { data: rows } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("role", role);
      profileIds = [...profileIds, ...(rows ?? []).map((r: any) => r.user_id)];
    }
  }

  if (profileIds.length === 0) return [];

  // 3. Look up OneSignal subscription IDs from push_tokens
  const { data: tokens } = await supabaseAdmin
    .from("push_tokens")
    .select("onesignal_id")
    .in("user_id", [...new Set(profileIds)]);

  return (tokens ?? []).map((t: any) => t.onesignal_id).filter(Boolean);
}

export const sendPushNotification = createServerFn({ method: "POST" })
  .inputValidator((data: PushPayload) => ({
    userIds:   (data?.userIds ?? []).filter(Boolean).slice(0, 100) as string[],
    title:     String(data?.title  ?? "").slice(0, 100),
    body:      String(data?.body   ?? "").slice(0, 200),
    targetUrl: data?.targetUrl ? String(data.targetUrl).slice(0, 300) : undefined,
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const appId  = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_API_KEY;

    if (!appId || !apiKey) {
      console.warn("Push: ONESIGNAL_APP_ID or ONESIGNAL_API_KEY not set");
      return { ok: false, error: "Push not configured" };
    }
    if (data.userIds.length === 0) return { ok: false, error: "No recipients" };

    // Resolve user IDs → OneSignal subscription IDs
    let subscriptionIds: string[];
    try {
      subscriptionIds = await resolveSubscriptionIds(data.userIds);
    } catch (err) {
      console.error("Push: failed to resolve subscription IDs:", err);
      return { ok: false, error: "Failed to resolve recipients" };
    }

    if (subscriptionIds.length === 0) {
      console.warn("Push: no push_tokens found for userIds:", data.userIds);
      return { ok: false, error: "No device tokens found — users may not have granted notification permission yet" };
    }

    const payload: Record<string, unknown> = {
      app_id:                    appId,
      include_subscription_ids:  subscriptionIds,
      headings:                  { en: data.title },
      contents:                  { en: data.body },
      android_channel_id:        "csc-clms",
      android_accent_color:      "FF2563EB",
      small_icon:                "ic_stat_notification",
    };

    if (data.targetUrl) {
      payload.data = { targetUrl: data.targetUrl };
    }

    try {
      const res = await fetch(OS_API, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Key ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("OneSignal error:", err);
        return { ok: false, error: err };
      }
      return { ok: true };
    } catch (err) {
      console.error("Push send error:", err);
      return { ok: false, error: String(err) };
    }
  });

// ── Convenience wrappers ──────────────────────────────────────────────────────

export async function notifyLeaveSubmitted(departmentId: string, teacherName: string, leaveType: string, days: number) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hodRoles } = await supabaseAdmin
      .from("user_roles").select("user_id").eq("role", "hod");
    const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
    if (hodUserIds.length === 0) return;
    const { data: hods } = await supabaseAdmin
      .from("profiles").select("id")
      .eq("department_id", departmentId).eq("approved", true)
      .in("id", hodUserIds);
    const hodIds = (hods ?? []).map((h: any) => h.id);
    if (hodIds.length === 0) return;
    return sendPushNotification({
      data: {
        userIds:   hodIds,
        title:     "New Leave Request",
        body:      `${teacherName} has applied for ${days} day(s) of ${leaveType} leave`,
        targetUrl: "/requests",
      },
    });
  } catch (err) {
    console.error("notifyLeaveSubmitted error:", err);
  }
}

export async function notifyLeaveApproved(teacherId: string, leaveType: string, days: number) {
  return sendPushNotification({
    data: {
      userIds:   [teacherId],
      title:     "Leave Approved ✓",
      body:      `Your ${leaveType} leave request for ${days} day(s) has been approved`,
      targetUrl: "/leaves",
    },
  });
}

export async function notifyLeaveRejected(teacherId: string, leaveType: string, reason?: string) {
  return sendPushNotification({
    data: {
      userIds:   [teacherId],
      title:     "Leave Rejected",
      body:      reason ? `Your ${leaveType} leave was rejected: ${reason}` : `Your ${leaveType} leave request has been rejected`,
      targetUrl: "/leaves",
    },
  });
}

export async function notifyProxyAssigned(proxyTeacherId: string, absenteeName: string, subject: string, date: string) {
  return sendPushNotification({
    data: {
      userIds:   [proxyTeacherId],
      title:     "Proxy Lecture Assigned",
      body:      `You have been assigned to cover ${subject} for ${absenteeName} on ${date}`,
      targetUrl: "/proxies",
    },
  });
}

export async function notifyNewRegistration(adminIds: string[], staffName: string, role: string) {
  return sendPushNotification({
    data: {
      userIds:   adminIds,
      title:     "New Registration Request",
      body:      `${staffName} has registered as ${role} and is awaiting approval`,
      targetUrl: "/admin",
    },
  });
}

export async function notifyNewNotice(recipientIds: string[], noticeTitle: string) {
  return sendPushNotification({
    data: {
      userIds:   recipientIds,
      title:     "New Notice",
      body:      noticeTitle,
      targetUrl: "/dashboard",
    },
  });
}

export async function notifyHodApproved(principalId: string, teacherName: string, leaveType: string) {
  return sendPushNotification({
    data: {
      userIds:   [principalId],
      title:     "Leave Awaiting Your Approval",
      body:      `${teacherName}'s ${leaveType} leave has been approved by HOD and needs your sign-off`,
      targetUrl: "/requests",
    },
  });
}
