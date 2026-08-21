import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-debug")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const result: Record<string, any> = {};
        const url = new URL(request.url);
        const userId = url.searchParams.get("userId");

        const appId  = process.env.ONESIGNAL_APP_ID;
        const apiKey = process.env.ONESIGNAL_API_KEY;

        result.env = {
          ONESIGNAL_APP_ID:          appId ? "✓ set" : "✗ MISSING",
          ONESIGNAL_API_KEY:         apiKey ? "✓ set" : "✗ MISSING",
          SUPABASE_URL:              process.env.SUPABASE_URL ? "✓ set" : "✗ MISSING",
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✓ set" : "✗ MISSING",
        };

        // push_tokens table
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: tokens, error } = await supabaseAdmin
            .from("push_tokens").select("user_id, onesignal_id, updated_at")
            .order("updated_at", { ascending: false }).limit(20);
          result.push_tokens = error ? { error: error.message } : { count: tokens?.length ?? 0, tokens };
        } catch (err) {
          result.push_tokens = { error: String(err) };
        }

        if (appId && apiKey) {
          // OneSignal app info
          try {
            const res = await fetch(`https://onesignal.com/api/v1/apps/${appId}`, {
              headers: { "Authorization": `Key ${apiKey}` },
            });
            const data = await res.json();
            result.onesignal_app = res.ok ? { name: data.name, players: data.players } : { error: data };
          } catch (err) {
            result.onesignal_app = { error: String(err) };
          }

          // List all players/subscriptions (up to 20)
          try {
            const res = await fetch(
              `https://onesignal.com/api/v1/players?app_id=${appId}&limit=20`,
              { headers: { "Authorization": `Key ${apiKey}` } }
            );
            const data = await res.json();
            if (res.ok) {
              result.onesignal_players = {
                total: data.total_count,
                players: (data.players ?? []).map((p: any) => ({
                  id: p.id,
                  external_user_id: p.external_user_id,
                  device_type: p.device_type, // 0=iOS, 1=Android
                  notification_types: p.notification_types, // 1=subscribed, -2=unsubscribed
                  last_active: p.last_active,
                  test_type: p.test_type,
                })),
              };
            } else {
              result.onesignal_players = { error: data };
            }
          } catch (err) {
            result.onesignal_players = { error: String(err) };
          }

          // If userId provided, look up by external_id
          if (userId) {
            try {
              const res = await fetch(
                `https://onesignal.com/api/v1/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`,
                { headers: { "Authorization": `Key ${apiKey}` } }
              );
              const data = await res.json();
              result.onesignal_user_lookup = res.ok ? data : { error: data };
            } catch (err) {
              result.onesignal_user_lookup = { error: String(err) };
            }
          }
        }

        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
