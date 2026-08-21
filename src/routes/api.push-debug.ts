import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// TEMPORARY DEBUG ENDPOINT — remove after notifications are working
// Visit /api/push-debug to see exactly what's wrong

export const Route = createFileRoute("/api/push-debug")({
  server: {
    handlers: {
      GET: async () => {
        const result: Record<string, any> = {};

        // 1. Check env vars
        result.env = {
          ONESIGNAL_APP_ID:        process.env.ONESIGNAL_APP_ID ? "✓ set" : "✗ MISSING",
          ONESIGNAL_API_KEY:       process.env.ONESIGNAL_API_KEY ? "✓ set" : "✗ MISSING",
          SUPABASE_URL:            process.env.SUPABASE_URL ? "✓ set" : "✗ MISSING",
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✓ set" : "✗ MISSING",
        };

        // 2. Check push_tokens table
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: tokens, error } = await supabaseAdmin
            .from("push_tokens")
            .select("user_id, onesignal_id, updated_at")
            .order("updated_at", { ascending: false })
            .limit(10);

          result.push_tokens = error
            ? { error: error.message }
            : { count: tokens?.length ?? 0, tokens };
        } catch (err) {
          result.push_tokens = { error: String(err) };
        }

        // 3. Test OneSignal API connectivity
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
          } else {
            result.onesignal_app = { skipped: "env vars missing" };
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
