import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/push-token")({
  server: {
    handlers: {
      // Called from client (Median bridge) with a known onesignalId
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await request.json() as { userId?: string; onesignalId?: string };
          const { userId, onesignalId } = body;

          if (!userId || !onesignalId) {
            return json({ ok: false, error: "Missing fields" }, 400);
          }

          await upsertToken(userId, onesignalId);
          return json({ ok: true });
        } catch (err) {
          console.error("[Push] POST error:", err);
          return json({ ok: false, error: String(err) }, 500);
        }
      },

      // Called server-side to sync tokens from OneSignal by externalId (userId)
      // GET /api/push-token?userId=xxx
      GET: async ({ request }: { request: Request }) => {
        try {
          const url = new URL(request.url);
          const userId = url.searchParams.get("userId");
          if (!userId) return json({ ok: false, error: "Missing userId" }, 400);

          const appId  = process.env.ONESIGNAL_APP_ID;
          const apiKey = process.env.ONESIGNAL_API_KEY;
          if (!appId || !apiKey) return json({ ok: false, error: "Push not configured" }, 500);

          // Query OneSignal for subscriptions linked to this externalId
          const res = await fetch(
            `https://onesignal.com/api/v1/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`,
            { headers: { "Authorization": `Key ${apiKey}` } }
          );

          if (!res.ok) {
            const err = await res.text();
            console.warn("[Push] OneSignal lookup failed:", err);
            return json({ ok: false, error: "User not found in OneSignal" }, 404);
          }

          const data = await res.json() as any;
          // subscriptions is an array of device subscriptions
          const subscriptions: any[] = data?.subscriptions ?? [];
          const ids = subscriptions
            .filter((s: any) => s.type === "AndroidPush" || s.type === "iOSPush")
            .map((s: any) => s.id)
            .filter(Boolean);

          if (ids.length === 0) {
            return json({ ok: false, error: "No push subscriptions found for this user in OneSignal" }, 404);
          }

          // Save all found subscription IDs
          for (const id of ids) {
            await upsertToken(userId, id);
          }

          console.log(`[Push] Synced ${ids.length} token(s) for user ${userId}`);
          return json({ ok: true, synced: ids.length });
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
