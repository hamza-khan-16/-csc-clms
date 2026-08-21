import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-token")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await request.json() as { userId?: string; onesignalId?: string };
          const { userId, onesignalId } = body;
          if (!userId || !onesignalId) return json({ ok: false, error: "Missing fields" }, 400);
          await upsertToken(userId, onesignalId);
          return json({ ok: true });
        } catch (err) {
          console.error("[Push] POST error:", err);
          return json({ ok: false, error: String(err) }, 500);
        }
      },

      // GET /api/push-token?userId=xxx  — syncs from OneSignal by external_id
      GET: async ({ request }: { request: Request }) => {
        try {
          const url = new URL(request.url);
          const userId = url.searchParams.get("userId");
          if (!userId) return json({ ok: false, error: "Missing userId" }, 400);

          const appId  = process.env.ONESIGNAL_APP_ID;
          const apiKey = process.env.ONESIGNAL_API_KEY;
          if (!appId || !apiKey) return json({ ok: false, error: "Push not configured" }, 500);

          // Fetch all players and find ones matching this userId
          // We scan all players because external_user_id may be stored as garbled JSON
          const res = await fetch(
            `https://onesignal.com/api/v1/players?app_id=${appId}&limit=300`,
            { headers: { "Authorization": `Key ${apiKey}` } }
          );

          if (!res.ok) {
            const err = await res.text();
            return json({ ok: false, error: err }, 500);
          }

          const data = await res.json() as any;
          const players: any[] = data?.players ?? [];

          // Parse external_user_id — handles both plain UUID and garbled JSON string
          function parseExternalId(raw: string | null | undefined): string | null {
            if (!raw) return null;
            // Plain UUID
            if (!raw.startsWith("{") && !raw.startsWith("\"")) return raw;
            // Garbled: "{\"externalId\":\"uuid\"}" or "\"uuid\""
            try {
              const parsed = JSON.parse(raw);
              if (typeof parsed === "string") return parsed;
              if (parsed?.externalId) return parsed.externalId;
            } catch {}
            // Try regex fallback
            const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            return match ? match[0] : null;
          }

          const matchingIds = players
            .filter((p: any) => parseExternalId(p.external_user_id) === userId)
            .map((p: any) => p.id)
            .filter(Boolean);

          if (matchingIds.length === 0) {
            return json({ ok: false, error: "No matching players found", userId, totalPlayers: players.length }, 404);
          }

          for (const id of matchingIds) {
            await upsertToken(userId, id);
          }

          console.log(`[Push] Synced ${matchingIds.length} token(s) for user ${userId}`);
          return json({ ok: true, synced: matchingIds.length, ids: matchingIds });
        } catch (err) {
          console.error("[Push] GET sync error:", err);
          return json({ ok: false, error: String(err) }, 500);
        }
      },
    },
  },
});

async function upsertToken(userId: string, onesignalId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("push_tokens").upsert(
    { user_id: userId, onesignal_id: onesignalId, updated_at: new Date().toISOString() },
    { onConflict: "user_id,onesignal_id" },
  );
  if (error) throw new Error(error.message);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
