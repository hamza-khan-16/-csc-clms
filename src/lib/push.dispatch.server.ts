'use server';
/**
 * push.dispatch.server.ts — server-only push dispatch logic
 *
 * Extracted from push.functions.ts so that client bundles never
 * try to import "@/integrations/supabase/client.server".
 * push.functions.ts re-exports everything through createServerFn wrappers.
 */


const OS_API = "https://onesignal.com/api/v1/notifications";

export interface PushPayload {
  userIds: string[];
  title: string;
  body: string;
  targetUrl?: string;
  excludeUserIds?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve user IDs / sentinels → OneSignal player IDs
// ─────────────────────────────────────────────────────────────────────────────
async function resolvePlayerIds(
  userIds: string[],
  excludeUserIds: string[] = []
): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let profileIds: string[] = userIds.filter((id) => !id.startsWith("__"));
  const sentinels = userIds.filter((id) => id.startsWith("__"));

  for (const sentinel of sentinels) {
    const deptMatch         = sentinel.match(/^__hod_dept_(.+)__$/);
    const deptTeachersMatch = sentinel.match(/^__dept_teachers_(.+)__$/);

    if (deptTeachersMatch) {
      const deptId = deptTeachersMatch[1];
      const { data: teachers } = await supabaseAdmin
        .from("profiles").select("id")
        .eq("department_id", deptId).eq("approved", true);
      profileIds = [...profileIds, ...(teachers ?? []).map((r: any) => r.id)];

    } else if (deptMatch) {
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
      const role = sentinel.replace(/^__|__$/g, "");
      const { data: rows } = await (supabaseAdmin as any)
        .from("user_roles").select("user_id").eq("role", role);
      profileIds = [...profileIds, ...(rows ?? []).map((r: any) => r.user_id)];
    }
  }

  if (profileIds.length === 0) return [];

  const unique = [...new Set(profileIds)].filter((id) => !excludeUserIds.includes(id));
  const { data: tokens, error } = await (supabaseAdmin as any)
    .from("push_tokens").select("onesignal_id").in("user_id", unique);

  if (error) { console.error("[Push] push_tokens lookup error:", error.message); return []; }

  const ids = (tokens ?? []).map((t: any) => t.onesignal_id).filter(Boolean);
  console.log(`[Push] Resolved ${unique.length} user(s) → ${ids.length} player ID(s):`, ids);
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core sender — server only
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

  const playerIds = await resolvePlayerIds(
    payload.userIds, payload.excludeUserIds ?? []
  ).catch((err) => { console.error("[Push] resolvePlayerIds threw:", err); return [] as string[]; });

  if (playerIds.length === 0) {
    console.warn("[Push] No player IDs found for:", payload.userIds);
    return { ok: false, error: "No device tokens found" };
  }

  const requestBody: Record<string, unknown> = {
    app_id:               appId,
    include_player_ids:   playerIds,
    headings:             { en: payload.title },
    contents:             { en: payload.body },
    android_channel_id:   "69e5e20c-9520-4afe-a46e-611bbcd905bc",
    android_accent_color: "FF2563EB",
    small_icon:           "ic_stat_notification",
  };
  if (payload.targetUrl) requestBody.data = { targetUrl: payload.targetUrl };

  console.log("[Push] Sending to", playerIds.length, "device(s):", payload.title);

  try {
    const res = await fetch(OS_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Key ${apiKey}` },
      body:    JSON.stringify(requestBody),
    });
    const text = await res.text();
    if (!res.ok) { console.error("[Push] OneSignal rejected:", text); return { ok: false, error: text }; }
    console.log("[Push] OneSignal accepted:", text);
    return { ok: true };
  } catch (err) {
    console.error("[Push] fetch threw:", err);
    return { ok: false, error: String(err) };
  }
}

// sendPushNotification removed — clients now call /api/push-send via firePush()
// which avoids all client-bundle crawling of this .server.ts file
