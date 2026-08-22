import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-token")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const { userId, onesignalId } = await request.json() as { userId?: string; onesignalId?: string };
          if (!userId || !onesignalId) return json({ ok: false, error: "Missing fields" }, 400);
          await upsertToken(userId, onesignalId);
          return json({ ok: true });
        } catch (err) {
          console.error("[Push] POST error:", err);
          return json({ ok: false, error: String(err) }, 500);
        }
      },

      GET: async ({ request }: { request: Request }) => {
        try {
          const url = new URL(request.url);
          const userId = url.searchParams.get("userId");
          if (!userId) return json({ ok: false, error: "Missing userId" }, 400);

          const appId  = process.env.ONESIGNAL_APP_ID;
          const apiKey = process.env.ONESIGNAL_API_KEY;
          if (!appId || !apiKey) return json({ ok: false, error: "Push not configured" }, 500);

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

          let offset = 0;
          const matchingIds: string[] = [];

          while (true) {
            const res = await fetch(
              `https://onesignal.com/api/v1/players?app_id=${appId}&limit=300&offset=${offset}`,
              { headers: { "Authorization": `Key ${apiKey}` } }
            );
            if (!res.ok) break;

            const data = await res.json() as any;
            const players: any[] = data?.players ?? [];

            for (const p of players) {
              if (parseExternalId(p.external_user_id) === userId) {
                matchingIds.push(p.id);
              }
            }

            if (players.length < 300) break;
            offset += 300;
          }

          if (matchingIds.length === 0) {
            return json({ ok: false, error: "No OneSignal subscription found for this user" }, 404);
          }

          for (const id of matchingIds) {
            await upsertToken(userId, id);
          }

          console.log(`[Push] Synced ${matchingIds.length} token(s) for user ${userId}`);
          return json({ ok: true, synced: matchingIds.length });
        } catch (err) {
          console.error("[Push] sync error:", err);
          return json({ ok: false, error: String(err) }, 500);
        }
      },
    },
  },
});

async function upsertToken(userId: string, onesignalId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Remove stale tokens for this device linked to OTHER users
  await supabaseAdmin
    .from("push_tokens")
    .delete()
    .eq("onesignal_id", onesignalId)
    .neq("user_id", userId);

  // Remove all OTHER devices previously linked to this user
  // (user switched to a new phone — old phone should no longer receive notifications)
  await supabaseAdmin
    .from("push_tokens")
    .delete()
    .eq("user_id", userId)
    .neq("onesignal_id", onesignalId);

  // Insert the current device
  const { error } = await supabaseAdmin.from("push_tokens").upsert(
    { user_id: userId, onesignal_id: onesignalId, updated_at: new Date().toISOString() },
    { onConflict: "user_id,onesignal_id" }
  );
  if (error) throw new Error(error.message);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
