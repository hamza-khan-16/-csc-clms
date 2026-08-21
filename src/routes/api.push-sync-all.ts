import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

<<<<<<< HEAD
=======
// One-time endpoint to sync ALL OneSignal players into push_tokens
// Visit /api/push-sync-all once after deploy — never needs to be run again
// (initPush handles new users automatically after this)

>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
export const Route = createFileRoute("/api/push-sync-all")({
  server: {
    handlers: {
      GET: async () => {
        const appId  = process.env.ONESIGNAL_APP_ID;
        const apiKey = process.env.ONESIGNAL_API_KEY;

        if (!appId || !apiKey) {
          return json({ ok: false, error: "Push env vars not set" }, 500);
        }

<<<<<<< HEAD
=======
        // Parse garbled external_user_id back to plain UUID
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
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

        let offset = 0;
        const limit = 300;
        let totalSynced = 0;
        let totalSkipped = 0;
        const errors: string[] = [];

<<<<<<< HEAD
=======
        // Page through all players
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
        while (true) {
          const res = await fetch(
            `https://onesignal.com/api/v1/players?app_id=${appId}&limit=${limit}&offset=${offset}`,
            { headers: { "Authorization": `Key ${apiKey}` } }
          );

          if (!res.ok) {
            errors.push(`OneSignal fetch failed at offset ${offset}: ${await res.text()}`);
            break;
          }

          const data = await res.json() as any;
          const players: any[] = data?.players ?? [];

          if (players.length === 0) break;

          for (const player of players) {
            const userId = parseExternalId(player.external_user_id);
            const onesignalId = player.id;

            if (!userId || !onesignalId) {
              totalSkipped++;
              continue;
            }

<<<<<<< HEAD
            const { error } = await supabaseAdmin.from("push_tokens").upsert(
              { user_id: userId, onesignal_id: onesignalId, updated_at: new Date().toISOString() },
              { onConflict: "user_id,onesignal_id" }
            );

            if (error) {
              errors.push(`Failed for ${userId}: ${error.message}`);
              totalSkipped++;
            } else {
              totalSynced++;
            }
          }

          if (players.length < limit) break;
          offset += limit;
        }

        console.log(`[Push] Sync-all complete: ${totalSynced} synced, ${totalSkipped} skipped`);

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
=======
>>>>>>> 3164c9ba938a1da163e21c2fb526d93d8a624e28
