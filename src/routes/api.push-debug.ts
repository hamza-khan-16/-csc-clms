import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-debug")({
  server: {
    handlers: {
      GET: async () => {
        const result: Record<string, any> = {};

        result.env = {
          ONESIGNAL_APP_ID:          process.env.ONESIGNAL_APP_ID ? "✓ set" : "✗ MISSING",
          ONESIGNAL_API_KEY:         process.env.ONESIGNAL_API_KEY ? "✓ set" : "✗ MISSING",
          SUPABASE_URL:              process.env.SUPABASE_URL ? "✓ set" : "✗ MISSING",
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✓ set" : "✗ MISSING",
        };

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: tokens, error } = await supabaseAdmin
            .from("push_tokens")
            .select("user_id, onesignal_id, updated_at")
            .order("updated_at", { ascending: false })
            .limit(20);
          result.push_tokens = error
            ? { error: error.message }
            : { count: tokens?.length ?? 0, tokens };
        } catch (err) {
          result.push_tokens = { error: String(err) };
        }

        try {
          const appId  = process.env.ONESIGNAL_APP_ID;
          const apiKey = process.env.ONESIGNAL_API_KEY;
          if (appId && apiKey) {
            const res = await fetch(`https://onesignal.com/api/v1/apps/${appId}`, {
              headers: { "Authorization": `Key ${apiKey}` },
            });
            const data = await res.json();
            result.onesignal_app = res.ok
              ? { ok: true, name: data.name, players: data.players }
              : { ok: false, error: data };
          }
        } catch (err) {
          result.onesignal_app = { error: String(err) };
        }

        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
