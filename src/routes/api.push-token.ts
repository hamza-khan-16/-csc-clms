import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-token")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const { userId, onesignalId } = await request.json() as { userId: string; onesignalId: string };

          if (!userId || !onesignalId) {
            return new Response(JSON.stringify({ ok: false, error: "Missing fields" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("push_tokens").upsert(
            {
              user_id:      userId,
              onesignal_id: onesignalId,
              updated_at:   new Date().toISOString(),
            },
            { onConflict: "user_id,onesignal_id" },
          );

          if (error) {
            console.error("[Push] DB upsert error:", error.message);
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          console.log("[Push] Token saved for user:", userId);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("[Push] API error:", err);
          return new Response(JSON.stringify({ ok: false, error: String(err) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
