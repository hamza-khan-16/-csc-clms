import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/proxy-cleanup
 *
 * Vercel Cron Job — runs daily at 17:30 UTC (23:00 IST), after all classes end.
 * Schedule set in vercel.json: "30 17 * * *"
 *
 * What it does:
 * 1. Finds all PENDING proxy assignments whose proxy_date <= today (the class day has ended).
 * 2. Marks them as "rejected" — their slots become "empty class" in all reports automatically
 *    (the reports engine shows NO PROXY for any leave slot with no accepted/pending proxy).
 * 3. Deduplicates: if multiple pending rows exist for the same slot (same leave_request_id +
 *    proxy_date + start_time + end_time), keeps only one rejection and deletes the rest.
 * 4. Notifies the HOD of each affected department.
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

          // 1. Fetch all pending proxies whose date has ended (cron runs at 23:00 IST)
          const { data: expired, error: fetchErr } = await supabaseAdmin
            .from("proxy_assignments")
            .select("id, proxy_date, start_time, end_time, subject, class_name, absentee_teacher_id, leave_request_id")
            .eq("status", "pending")
            .lte("proxy_date", today);

          if (fetchErr) {
            console.error("[proxy-cleanup] fetch error:", fetchErr.message);
            return r({ error: fetchErr.message }, 500);
          }

          if (!expired || expired.length === 0) {
            console.log("[proxy-cleanup] No expired pending proxies found.");
            return r({ ok: true, expired: 0, deduplicated: 0 });
          }

          console.log(`[proxy-cleanup] Found ${expired.length} expired pending proxies`);

          // 2. Deduplicate by slot: group by (leave_request_id | proxy_date | start_time | end_time).
          //    Keep one row per unique slot (mark rejected = empty class), delete the rest.
          //    This cleans up duplicate rows from repeated proxy assignments for the same slot.
          const slotMap = new Map<string, typeof expired>();
          for (const row of expired) {
            const key = `${row.leave_request_id}|${row.proxy_date}|${row.start_time}|${row.end_time}`;
            if (!slotMap.has(key)) slotMap.set(key, []);
            slotMap.get(key)!.push(row);
          }

          const toKeep: string[] = [];    // one id per unique slot — mark rejected = empty class
          const toDelete: string[] = [];  // duplicates — just delete
          for (const group of slotMap.values()) {
            toKeep.push(group[0].id);
            for (let i = 1; i < group.length; i++) toDelete.push(group[i].id);
          }

          // Delete duplicate rows first
          let deduplicated = 0;
          if (toDelete.length > 0) {
            const { error: delErr } = await supabaseAdmin
              .from("proxy_assignments")
              .delete()
              .in("id", toDelete);
            if (delErr) console.error("[proxy-cleanup] dedup delete error:", delErr.message);
            else deduplicated = toDelete.length;
            console.log(`[proxy-cleanup] Deleted ${deduplicated} duplicate proxy rows`);
          }

          // 3. Mark remaining (one per slot) as "rejected" → empty class in all reports.
          //    Reports show NO PROXY for any leave slot with no accepted/pending proxy row.
          const { error: updateErr } = await supabaseAdmin
            .from("proxy_assignments")
            .update({ status: "rejected" })
            .in("id", toKeep);

          if (updateErr) {
            console.error("[proxy-cleanup] update error:", updateErr.message);
            return r({ error: updateErr.message }, 500);
          }

          // 4. Notify HODs — group by dept of absentee teacher
          const representativeRows = expired.filter((e) => toKeep.includes(e.id));
          const absenteeIds = [...new Set(
            representativeRows.map((e) => e.absentee_teacher_id).filter((id): id is string => !!id)
          )];

          if (absenteeIds.length > 0) {
            const { data: absenteeProfiles } = await supabaseAdmin
              .from("profiles")
              .select("id, department_id, full_name")
              .in("id", absenteeIds);

            const byDept = new Map<string, { count: number; names: Set<string> }>();
            for (const slot of representativeRows) {
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
                title: "Proxy Expired — Empty Class",
                body: `${info.count} unresolved proxy slot${info.count > 1 ? "s" : ""} for ${teacherNames} ${info.count > 1 ? "were" : "was"} automatically marked as empty class (no teacher responded before the class ended).`,
                targetUrl: "/requests",
              }).catch(() => {});
            }
          }

          return r({ ok: true, expired: toKeep.length, deduplicated });
        } catch (err) {
          console.error("[proxy-cleanup] error:", err);
          return r({ error: String(err) }, 500);
        }
      },
    },
  },
});
