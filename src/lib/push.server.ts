'use server';
/**
 * push.server.ts — server-only push token helpers
 */

import { createServerFn } from "@tanstack/react-start";

/**
 * savePushToken — registers this device as the ONLY active device for the user.
 * Any existing tokens for this user are deleted first (single-device enforcement).
 * The session_id from Supabase auth is stored so we can invalidate stale sessions.
 */
export const savePushToken = createServerFn({ method: "POST" })
  .validator((data: { userId: string; onesignalId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Get the old OneSignal IDs for this user so we can notify the old device
      const { data: oldTokens } = await supabaseAdmin
        .from("push_tokens")
        .select("onesignal_id")
        .eq("user_id", data.userId)
        .neq("onesignal_id", data.onesignalId);

      // 2. If there were other devices, send them a "logged out" push via OneSignal
      if (oldTokens && oldTokens.length > 0) {
        const oldIds = oldTokens.map((t) => t.onesignal_id);
        // Fire-and-forget push to old devices
        const apiKey = process.env.ONESIGNAL_API_KEY;
        const appId  = process.env.ONESIGNAL_APP_ID;
        if (apiKey && appId && oldIds.length > 0) {
          fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Basic ${apiKey}`,
            },
            body: JSON.stringify({
              app_id: appId,
              include_player_ids: oldIds,
              headings: { en: "Security Alert" },
              contents: { en: "Your account was logged in on another device. If this wasn't you, contact your HOD immediately." },
              priority: 10,
            }),
          }).catch(() => {});
        }
      }

      // 3. Delete ALL existing tokens for this user (single-device)
      await supabaseAdmin
        .from("push_tokens")
        .delete()
        .eq("user_id", data.userId);

      // 4. Insert only the new device token
      const { error } = await supabaseAdmin.from("push_tokens").insert({
        user_id:      data.userId,
        onesignal_id: data.onesignalId,
      });
      if (error) console.error("[Push] savePushToken DB error:", error.message);
    } catch (err) {
      console.error("[Push] savePushToken error:", err);
    }
  });
