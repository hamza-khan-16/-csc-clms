import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const r = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/push-send")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const payload = await request.json();
          const { dispatchPush } = await import("@/lib/push.dispatch.server");
          const result = await dispatchPush(payload);
          return r(result);
        } catch (err) {
          console.error("[Push] api/push-send error:", err);
          return r({ ok: false, error: String(err) }, 500);
        }
      },
    },
  },
});
