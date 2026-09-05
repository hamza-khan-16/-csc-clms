'use server';
/**
 * push.server.ts — server-only push token helpers
 * Kept separate from push.ts (client file) to avoid TanStack Start crawl errors.
 */

import { createServerFn } from "@tanstack/react-start";

export const savePushToken = createServerFn({ method: "POST" })
  .validator((data: { userId: string; onesignalId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("push_tokens").upsert(
        {
          user_id:      data.userId,
          onesignal_id: data.onesignalId,
        },
        { onConflict: "user_id,onesignal_id" },
      );
      if (error) console.error("[Push] savePushToken DB error:", error.message);
    } catch (err) {
      console.error("[Push] savePushToken error:", err);
    }
  });
