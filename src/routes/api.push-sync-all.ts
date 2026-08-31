import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-sync-all")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        // Admin-only — requires DEBUG_SECRET in Authorization header
        const authHeader = request.headers.get("authorization") ?? "";
        const debugSecret = process.env.DEBUG_SECRET;
        if (!debugSecret || authHeader !== `Bearer ${debugSecret}`) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const appId  = process.env.ONESIGNAL_APP_ID;
        const apiKey = process.env.ONESIGNAL_API_KEY;
        if (!appId || !apiKey) return json({ ok: false, error: "Push env vars not set" }, 500);

        function parseExternalId(raw: string | null | undefined): string | null {
          if (!raw) return null;
          if (!raw.startsWith("{") && !raw.startsWith("\"")) return raw;
          try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === "string") return parsed;
            if (parsed?.externalId) return parsed.externalId;
          } catch {}
          const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          return match ? match[0] : null;
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Fetch all approved users from Supabase and sync each one via OneSignal Identity API
        // This replaces the deprecated /api/v1/players paginated endpoint
        let totalSynced = 0;
        let totalSkipped = 0;
        const errors: string[] = [];

        const { data: allUsers } = await (supabaseAdmin as any)
          .from("profiles").select("id").eq("approved", true);

        for (const user of allUsers ?? []) {
          const userId = user.id as string;
          try {
            const res = await fetch(
              `https://onesignal.com/api/v1/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`,
              { headers: { "Authorization": `Key ${apiKey}` } }
            );
            if (!res.ok) { totalSkipped++; continue; }
            const data = await res.json() as any;
            const subs: any[] = (data?.subscriptions ?? []).filter((s: any) =>
              s.type === "AndroidPush" || s.type === "iOSPush" || s.type === "ChromePush"
            );
            for (const sub of subs) {
              const onesignalId = sub.id;
              if (!onesignalId) continue;
              const { error } = await (supabaseAdmin as any).from("push_tokens").upsert(
                { user_id: userId, onesignal_id: onesignalId, updated_at: new Date().toISOString() },
                { onConflict: "user_id,onesignal_id" }
              );
              if (error) { errors.push(`Failed for ${userId}: ${error.message}`); totalSkipped++; }
              else totalSynced++;
            }
          } catch (e) {
            errors.push(`Error for ${userId}: ${String(e)}`);
            totalSkipped++;
          }
        }

        return json({ ok: true, synced: totalSynced, skipped: totalSkipped, errors: errors.length > 0 ? errors : undefined });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
