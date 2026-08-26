import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-debug")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        // Admin-only endpoint — verify Authorization header or session cookie
        const authHeader = request.headers.get("authorization") ?? "";
        const debugSecret = process.env.DEBUG_SECRET;
        if (!debugSecret || authHeader !== `Bearer ${debugSecret}`) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

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

        try {
          const { supabaseAdmin: _supabaseAdminTyped } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAdmin = _supabaseAdminTyped as any;
          const { data: tokens, error } = await supabaseAdmin
            .from("push_tokens").select("user_id, onesignal_id")
            .limit(20);
          result.push_tokens = error ? { error: error.message } : { count: tokens?.length ?? 0, tokens };
        } catch (err) {
          result.push_tokens = { error: String(err) };
        }

        if (appId && apiKey) {
          try {
            const res = await fetch(`https://onesignal.com/api/v1/apps/${appId}`, {
              headers: { "Authorization": `Key ${apiKey}` },
            });
            const data = await res.json();
            result.onesignal_app = res.ok ? { name: data.name, players: data.players } : { error: data };
          } catch (err) { result.onesignal_app = { error: String(err) }; }

          try {
            const res = await fetch(`https://onesignal.com/api/v1/players?app_id=${appId}&limit=20`, {
              headers: { "Authorization": `Key ${apiKey}` },
            });
            const data = await res.json();
            if (res.ok) {
              result.onesignal_players = {
                total: data.total_count,
                players: (data.players ?? []).map((p: any) => ({
                  id: p.id,
                  external_user_id: p.external_user_id,
                  device_type: p.device_type,
                  notification_types: p.notification_types,
                  last_active: p.last_active,
                })),
              };
            } else { result.onesignal_players = { error: data }; }
          } catch (err) { result.onesignal_players = { error: String(err) }; }

          if (userId) {
            try {
              const res = await fetch(
                `https://onesignal.com/api/v1/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`,
                { headers: { "Authorization": `Key ${apiKey}` } }
              );
              const data = await res.json();
              result.onesignal_user_lookup = res.ok ? data : { error: data };
            } catch (err) { result.onesignal_user_lookup = { error: String(err) }; }
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
