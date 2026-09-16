import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/proxy-cleanup
 *
 * Vercel Cron Job — runs daily at 23:00 IST (17:30 UTC).
 * Schedule set in vercel.json: "0 23 * * *" (UTC) ≈ midnight IST.
 *
 * What it does:
 * 1. Finds all pending proxy assignments whose proxy_date has passed (< today).
 * 2. Marks them as "rejected" (expired) — they become "empty class" in reports.
 * 3. Notifies the HOD of each affected department so they're aware.
 *
 * Security: Vercel Cron calls include a secret header. We validate it to ensure
 * only Vercel can trigger this endpoint.
 */

const r = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/proxy-cleanup")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        // Validate Vercel cron secret to prevent unauthorized calls
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret) {
          const authHeader = request.headers.get("authorization");
          if (authHeader !== `Bearer ${cronSecret}`) {
            return r({ error: "Unauthorized" }, 401);
          }
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const today = new Date().toISOString().slice(0, 10);

          // 1. Find all pending proxy assignments whose date has passed (including today — cron runs at 23:00 IST)
          const { data: expired, error: fetchErr } = await supabaseAdmin
            .from("proxy_assignments")
            .select("id, proxy_date, subject, class_name, start_time, absentee_teacher_id, leave_request_id")
            .eq("status", "pending")
            .lte("proxy_date", today); // <= today: by 23:00 IST the class day is over

          if (fetchErr) {
            console.error("[proxy-cleanup] fetch error:", fetchErr.message);
            return r({ error: fetchErr.message }, 500);
          }

          if (!expired || expired.length === 0) {
            console.log("[proxy-cleanup] No expired pending proxies found.");
            return r({ ok: true, expired: 0 });
          }

          console.log(`[proxy-cleanup] Found ${expired.length} expired pending proxies`);

          // 2. Mark them all as "rejected" (empty class)
          const ids = expired.map((e) => e.id);
          const { error: updateErr } = await supabaseAdmin
            .from("proxy_assignments")
            .update({ status: "rejected" })
            .in("id", ids);

          if (updateErr) {
            console.error("[proxy-cleanup] update error:", updateErr.message);
            return r({ error: updateErr.message }, 500);
          }

          // 3. Notify HODs — group by dept of absentee teacher
          const absenteeIds = [...new Set(expired.map((e) => e.absentee_teacher_id).filter((id): id is string => !!id))];
          if (absenteeIds.length > 0) {
            const { data: absenteeProfiles } = await supabaseAdmin
              .from("profiles")
              .select("id, department_id, full_name")
              .in("id", absenteeIds);

            // Group expired slots by dept
            const byDept = new Map<string, { count: number; names: Set<string> }>();
            for (const slot of expired) {
              const profile = absenteeProfiles?.find((p) => p.id === slot.absentee_teacher_id);
              if (!profile?.department_id) continue;
              const dept = profile.department_id;
              if (!byDept.has(dept)) byDept.set(dept, { count: 0, names: new Set() });
              byDept.get(dept)!.count++;
              byDept.get(dept)!.names.add(profile.full_name);
            }

            const { dispatchPush } = await import("@/lib/push.dispatch.server");
            for (const [deptId, info] of byDept) {
              const teacherNames = [...info.names].join(", ");
              await dispatchPush({
                userIds: [`__hod_dept_${deptId}__`],
                title: "Proxy Assignments Expired",
                body: `${info.count} unresolved proxy assignment${info.count > 1 ? "s" : ""} for ${teacherNames} were automatically marked as empty class (no teacher responded in time).`,
                targetUrl: "/requests",
              }).catch(() => {});
            }
          }

          return r({ ok: true, expired: expired.length });
        } catch (err) {
          console.error("[proxy-cleanup] error:", err);
          return r({ error: String(err) }, 500);
        }
      },
    },
  },
});
