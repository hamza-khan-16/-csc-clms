import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// One-time endpoint to sync ALL OneSignal players into push_tokens
// Visit /api/push-sync-all once after deploy — never needs to be run again
// (initPush handles new users automatically after this)

export const Route = createFileRoute("/api/push-sync-all")({
  server: {
    handlers: {
      GET: async () => {
        const appId  = process.env.ONESIGNAL_APP_ID;
        const apiKey = process.env.ONESIGNAL_API_KEY;

        if (!appId || !apiKey) {
          return json({ ok: false, error: "Push env vars not set" }, 500);
        }

        // Parse garbled external_user_id back to plain UUID
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

        // Page through all players
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

