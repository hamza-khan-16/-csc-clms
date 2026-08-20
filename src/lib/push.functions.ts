/**
 * push.functions.ts
 *
 * Server-side OneSignal REST API calls.
 * Required env vars (server-only, no VITE_ prefix):
 *   ONESIGNAL_APP_ID=<your_app_id>
 *   ONESIGNAL_API_KEY=<your_rest_api_key>
 */

import { createServerFn } from "@tanstack/react-start";

const OS_API = "https://onesignal.com/api/v1/notifications";

export interface PushPayload {
  /** OneSignal external user IDs (profile IDs) to target */
  userIds: string[];
  title: string;
  body: string;
  /** Deep-link path inside the app, e.g. "/requests" or "/dashboard" */
  targetUrl?: string;
}

export const sendPushNotification = createServerFn({ method: "POST" })
  .inputValidator((data: PushPayload) => ({
    userIds: (data?.userIds ?? []).filter(Boolean).slice(0, 100) as string[],
    title:   String(data?.title  ?? "").slice(0, 100),
    body:    String(data?.body   ?? "").slice(0, 200),
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

    // Resolve role sentinels to real user IDs:
    //   __principal__          → all users with role=principal
    //   __admin__              → all users with role=admin
    //   __hod__                → all users with role=hod
    //   __hod_dept_<deptId>__  → HODs in a specific department
    let resolvedIds = data.userIds.filter((id) => !id.startsWith("__"));
    const sentinels = data.userIds.filter((id) => id.startsWith("__"));
    if (sentinels.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (const sentinel of sentinels) {
        const deptMatch = sentinel.match(/^__hod_dept_(.+)__$/);
        if (deptMatch) {
          // Resolve HODs in a specific department
          const deptId = deptMatch[1];
          const { data: hodRoles } = await supabaseAdmin
            .from("user_roles").select("user_id").eq("role", "hod");
          const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
          const { data: deptHods } = await supabaseAdmin
            .from("profiles").select("id")
            .eq("department_id", deptId).eq("approved", true)
            .in("id", hodUserIds);
          resolvedIds = [...resolvedIds, ...(deptHods ?? []).map((r: any) => r.id)];
        } else {
          const role = sentinel.replace(/__/g, "");
          const { data: rows } = await supabaseAdmin
            .from("user_roles").select("user_id").eq("role", role);
          resolvedIds = [...resolvedIds, ...(rows ?? []).map((r: any) => r.user_id)];
        }
      }
    }
    if (resolvedIds.length === 0) return { ok: false, error: "No resolved recipients" };

    const payload: Record<string, unknown> = {
      app_id:                           appId,
      include_aliases:                  { external_id: resolvedIds },
      target_channel:                   "push",
      headings:                         { en: data.title },
      contents:                         { en: data.body },
      android_channel_id:               "csc-clms",   // set this up in OneSignal dashboard
      android_accent_color:             "FF2563EB",
      small_icon:                       "ic_stat_notification",
    };

    // Deep-link: Median reads targetUrl from additional_data
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

// ── Convenience wrappers for each notification event ─────────────────────────

/** Teacher submitted a leave → look up HOD for their department and notify them */
export async function notifyLeaveSubmitted(departmentId: string, teacherName: string, leaveType: string, days: number) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hodRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "hod");
    const hodUserIds = (hodRoles ?? []).map((r: any) => r.user_id);
    if (hodUserIds.length === 0) return;

    const { data: hods } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("department_id", departmentId)
      .eq("approved", true)
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

/** HOD/principal approved a leave → notify teacher */
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

/** HOD/principal rejected a leave → notify teacher */
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

/** HOD assigned a proxy lecture → notify proxy teacher */
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

/** New staff registered → notify admin and HR */
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

/** New notice posted → notify all recipients */
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

/** HOD approved a leave and it needs principal approval → notify principal */
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
